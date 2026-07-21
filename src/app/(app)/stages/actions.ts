"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  createEnvelope,
  getEnvelope,
  resendRecipient,
  downloadSignedPdf,
  isSignatureConfigured,
} from "@/lib/signature";
import { generateContractPdf, SIGNATURE_FIELD } from "@/lib/contract-pdf";
import { getContractTemplate } from "@/lib/contract-template";
import { sendSignatureFromStage } from "@/lib/signature-send-core";
import { generateInvoiceFor } from "@/lib/invoice-generate-core";
import { sendEmail, isEmailConfigured } from "@/lib/email-send";
import {
  computePrice,
  ESCROW_FEE,
  normalizeTravelFee,
  parseLineItems,
  sumLineItems,
  type SelectedAddOn,
} from "@/lib/pricing";
import { requireAdmin } from "@/lib/require-admin";
import { isTeamRole, requireTeamMember } from "@/lib/permissions";
import { notifyStatusChange } from "@/lib/notify";
import {
  type StageLength,
  normalizeStageLength,
} from "@/lib/stage-length";
import { logActivity } from "@/lib/activity-log";

/**
 * Default destage = stage_date + 60 days. House staging contracts run
 * a standard 60-day term; when the user sets a stage date and leaves
 * destage empty, fill it in for them. Returns the existing destage
 * unchanged if the user already typed something.
 */
function parseIntOrNull(v: FormDataEntryValue | null): number | null {
  if (v == null || v === "") return null;
  const n = parseInt(String(v).replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

function parseFloatOrNull(v: FormDataEntryValue | null): number | null {
  if (v == null || v === "") return null;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse the new "Extended 90-day stage" checkbox. Returns 60 or 90.
 * Accepts either an explicit `stage_length_days` numeric (used by
 * server-to-server calls) or the simpler `extended_stage` checkbox
 * the new-stage / new-estimate forms emit. Constants + types are in
 * src/lib/stage-length.ts (server-action files can only export async
 * functions, so they can't live here).
 */
function parseStageLengthFromForm(formData: FormData): StageLength {
  const explicit = formData.get("stage_length_days");
  if (explicit != null && explicit !== "") return normalizeStageLength(explicit);
  const ext = formData.get("extended_stage");
  return ext === "on" || ext === "true" ? 90 : 60;
}

function defaultDestage(
  stageDate: string | null,
  destageDate: string | null,
  lengthDays: number = 60,
): string | null {
  if (destageDate) return destageDate;
  if (!stageDate || !/^\d{4}-\d{2}-\d{2}$/.test(stageDate)) return destageDate;
  const [y, m, d] = stageDate.split("-").map(Number);
  // Use UTC math so the day-of-month doesn't drift across timezones.
  const t = Date.UTC(y, m - 1, d) + lengthDays * 86400000;
  const dt = new Date(t);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * Parse the hidden fields emitted by <PackagePicker />: package_key,
 * add_ons (JSON-encoded SelectedAddOn[]), discount. Compute the authoritative
 * amount server-side so the client can't send whatever total it wants.
 */
function parsePricingFromForm(formData: FormData) {
  // Escrow + travel-fee are independent of pricing mode — both add
  // flat amounts to the saved total and are recorded on the stage
  // (stages.escrow, stages.travel_fee).
  const escrow =
    formData.get("escrow") === "on" || formData.get("escrow") === "true";
  const escrowFee = escrow ? ESCROW_FEE : 0;
  const travelFee = normalizeTravelFee(formData.get("travel_fee"));
  // Custom line items add their prices to the saved total in either
  // pricing mode and are rendered on the estimate / contract / invoice.
  const lineItems = parseLineItems(formData.get("line_items"));
  const lineItemsTotal = sumLineItems(lineItems);

  // Custom-price mode short-circuits the catalog — the admin typed a
  // dollar amount and we just use that, leaving package_key/add_ons/
  // discount empty so the PDF generators fall back to a single line
  // item (plus any custom line items).
  const customAmountRaw = formData.get("custom_amount");
  if (typeof customAmountRaw === "string" && customAmountRaw.trim() !== "") {
    const n = Number(customAmountRaw);
    if (Number.isFinite(n) && n > 0) {
      return {
        packageKey: null,
        addOns: [] as SelectedAddOn[],
        discount: 0,
        escrow,
        travelFee,
        lineItems,
        amount: n + escrowFee + travelFee + lineItemsTotal,
      };
    }
  }

  const packageKey = (formData.get("package_key") as string) || null;
  const discount = Number(formData.get("discount") || 0);

  let addOns: SelectedAddOn[] = [];
  const raw = formData.get("add_ons");
  if (typeof raw === "string" && raw.length > 0) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        addOns = parsed
          .filter((x) => x && typeof x.key === "string")
          .map((x) => ({ key: x.key, qty: Math.max(0, Number(x.qty) || 0) }))
          .filter((x) => x.qty > 0);
      }
    } catch {
      // ignore malformed payload; treat as no add-ons
    }
  }

  const breakdown = computePrice(packageKey, addOns, discount);
  return {
    packageKey,
    addOns,
    discount: breakdown.discount,
    escrow,
    travelFee,
    lineItems,
    amount: breakdown.total + escrowFee + travelFee + lineItemsTotal,
  };
}

/**
 * Generate the staging agreement PDF for a stage, upload it to Supabase
 * Storage (so SignatureAPI can fetch it by URL), and create an envelope.
 * Updates the stage row with tracking fields. Silently no-ops if either
 * integration isn't configured or the client has no email.
 */
async function sendSignatureRequest(stageId: string) {
  if (!isSignatureConfigured()) {
    throw new Error(
      "Signature provider isn't configured (SIGNATURE_API_KEY missing on the server)."
    );
  }
  // Thin wrapper around the shared pipeline (also used by the
  // estimate-accept flow). The signature send needs an authenticated
  // supabase client here so the contracts-bucket RLS allows the upload.
  const supabase = await createClient();
  await sendSignatureFromStage(supabase, stageId);
}

export async function createStageAction(formData: FormData) {
  const supabase = await createClient();
  const pricing = parsePricingFromForm(formData);

  // <ClientSelect /> submits either `client_id` (existing) or
  // `new_client_name` + optional email/phone (inline create). Handle both.
  let clientId = String(formData.get("client_id") || "");
  const newClientName = String(formData.get("new_client_name") || "").trim();
  if (!clientId && newClientName) {
    const newClient = {
      name: newClientName,
      email: (formData.get("new_client_email") as string)?.trim() || null,
      phone: (formData.get("new_client_phone") as string)?.trim() || null,
    };
    const { data: created, error: cErr } = await supabase
      .from("clients")
      .insert(newClient)
      .select("id")
      .single();
    if (cErr) throw new Error(`Could not create client: ${cErr.message}`);
    clientId = created.id;
    revalidatePath("/clients");
  }

  const stageDate = (formData.get("stage_date") as string) || null;
  const stageLengthDays = parseStageLengthFromForm(formData);
  const payload = {
    client_id: clientId,
    address: String(formData.get("address") || "").trim(),
    amount: pricing.amount,
    package_key: pricing.packageKey,
    add_ons: pricing.addOns,
    discount: pricing.discount,
    escrow: pricing.escrow,
    travel_fee: pricing.travelFee,
    line_items: pricing.lineItems,
    stage_date: stageDate,
    stage_length_days: stageLengthDays,
    destage_date: defaultDestage(
      stageDate,
      (formData.get("destage_date") as string) || null,
      stageLengthDays,
    ),
    notes: (formData.get("notes") as string) || null,
    status: (formData.get("status") as string) || "scheduled",
    lockbox_code: (formData.get("lockbox_code") as string)?.trim() || null,
    city: (formData.get("city") as string)?.trim() || null,
    square_footage: parseIntOrNull(formData.get("square_footage")),
    bedrooms: parseIntOrNull(formData.get("bedrooms")),
    bathrooms: parseFloatOrNull(formData.get("bathrooms")),
    zillow_url: ((formData.get("zillow_url") as string) || "").trim() || null,
    primary_only:
      formData.get("primary_only") === "on" ||
      formData.get("primary_only") === "true",
    secondary_recipient_name:
      ((formData.get("secondary_recipient_name") as string) || "").trim() ||
      null,
    secondary_recipient_email:
      ((formData.get("secondary_recipient_email") as string) || "")
        .trim()
        .toLowerCase() || null,
  };
  if (!payload.client_id || !payload.address) {
    throw new Error("Client and address are required");
  }
  // Either a package OR a custom price > 0 is required.
  if (!pricing.packageKey && !(pricing.amount > 0)) {
    throw new Error("Pick a package or enter a custom price");
  }
  const { data, error } = await supabase
    .from("stages")
    .insert(payload)
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  // Upload any photos picked on the form. Failures here don't block the
  // stage itself — surface them in the server log and keep going.
  const photos = formData.getAll("photos") as File[];
  for (const f of photos) {
    if (f && typeof f !== "string" && f.size > 0) {
      try {
        await saveStagePhoto(data.id, f, null);
      } catch (e) {
        console.error("Stage photo upload failed:", e);
      }
    }
  }

  // Activity log entry — snapshot who created what.
  await logActivity(supabase, {
    kind: "stage_created",
    stageId: data.id,
    stageAddress: payload.address,
    details: { status: payload.status },
  });
  // Signature request is a best-effort side effect. If SIGNATURE_API_KEY
  // is missing or the provider returns an error, the stage is already
  // saved and the user should still land on the detail page. The admin
  // can hit "Send signature" manually from there. Log and keep going.
  try {
    await sendSignatureRequest(data.id);
  } catch (e) {
    console.error("[createStageAction] sendSignatureRequest failed:", e);
  }

  revalidatePath("/stages");
  redirect(`/stages/${data.id}`);
}

export type SignatureSendResult = { ok: true } | { ok: false; error: string };

export async function resendSignatureForStageAction(
  id: string
): Promise<SignatureSendResult> {
  try {
    if (!isSignatureConfigured()) {
      throw new Error("SIGNATURE_API_KEY missing on the server");
    }
    const supabase = await createClient();

    // Re-deliver the existing envelope if there is one, so we don't
    // strand the original (potentially-already-signed) document by
    // overwriting its ID with a fresh envelope.
    const { data: stage } = await supabase
      .from("stages")
      .select(
        "signature_envelope_id, signature_status, secondary_recipient_email",
      )
      .eq("id", id)
      .single();

    // A hard bounce means the address is undeliverable — resending to the
    // same recipient will keep failing. Tell the admin to fix the email
    // and send a fresh agreement instead of returning a vague error.
    if ((stage?.signature_status ?? "").toLowerCase().includes("bounce")) {
      return {
        ok: false,
        error:
          "That email bounced (undeliverable) — likely a typo. Fix the client's email, then use \"Send updated agreement\" to send a fresh copy.",
      };
    }

    if (stage?.signature_envelope_id) {
      // Look up the recipients on the existing envelope. SignatureAPI's
      // resend endpoint takes a recipient ID, not an envelope ID, so we
      // have to fetch the envelope first to discover them.
      const envelope = await getEnvelope(stage.signature_envelope_id);
      const recipientsRaw =
        (envelope as unknown as { recipients?: unknown }).recipients;
      const recipients: {
        id?: string;
        type?: string;
        status?: string;
      }[] =
        Array.isArray(recipientsRaw)
          ? (recipientsRaw as { id?: string; type?: string; status?: string }[])
          : [];
      const signers = recipients.filter((r) => r.type === "signer");
      if (signers.length === 0) {
        throw new Error(
          "Couldn't find a recipient on the existing envelope to resend to. Use 'Send for signature' to start a new one.",
        );
      }
      if (
        signers.every(
          (s) => String(s.status || "").toLowerCase() === "completed",
        )
      ) {
        throw new Error("This envelope is already signed.");
      }

      // Legacy envelopes were created with the SignatureAPI default of
      // "sequential" routing — meaning only the next-in-line signer is
      // notified, and resending the secondary just no-ops. If this
      // envelope has multiple signers but isn't parallel (or has only
      // 1 recipient when the stage now has a secondary), regenerate so
      // both signers actually get an email.
      const routing = String(
        (envelope as unknown as { routing?: unknown }).routing ?? "",
      ).toLowerCase();
      const stageHasSecondary = !!stage.secondary_recipient_email;
      const needsParallelRegen =
        stageHasSecondary &&
        (signers.length < 2 || routing !== "parallel");
      if (needsParallelRegen) {
        await sendSignatureRequest(id);
        revalidatePath(`/stages/${id}`);
        return { ok: true };
      }

      // Resend to every non-completed signer in parallel. SignatureAPI
      // rate-limits the per-recipient resend endpoint; per-recipient
      // failures (rate-limit or otherwise) are logged but don't fail
      // the whole action as long as at least one resend went through.
      const pending = signers.filter(
        (s) =>
          !!s.id && String(s.status || "").toLowerCase() !== "completed",
      );
      let resent = 0;
      for (const s of pending) {
        try {
          await resendRecipient(s.id!);
          resent += 1;
        } catch (e) {
          console.warn(
            "[resendSignatureForStageAction recipient resend]",
            s.id,
            e,
          );
        }
      }
      if (resent === 0) {
        throw new Error(
          "Couldn't resend to any signer (rate-limited or already completed).",
        );
      }

      // Bump sent_at so the UI reflects the latest delivery.
      await supabase
        .from("stages")
        .update({
          signature_sent_at: new Date().toISOString(),
          signature_status: stage.signature_status || "sent",
        })
        .eq("id", id);
      revalidatePath(`/stages/${id}`);
      return { ok: true };
    }

    // First-time send: build the PDF, upload, create the envelope.
    await sendSignatureRequest(id);
    revalidatePath(`/stages/${id}`);
    return { ok: true };
  } catch (e: any) {
    console.error("resendSignatureForStageAction failed:", e);
    return {
      ok: false,
      error: e?.message || "Failed to send signature request",
    };
  }
}

/**
 * Send a BRAND-NEW agreement for signature, replacing whatever envelope
 * is currently on the stage. Use this when the amount (or any contract
 * detail) changed after the original was sent/signed: the old envelope
 * has the stale figure, so a plain "resend" would re-deliver the wrong
 * document. This rebuilds the contract PDF from the current stage data
 * (new amount), creates a fresh envelope, and resets the signature
 * state.
 *
 * It also clears the auto-invoice gate (invoice_pdf_url +
 * invoice_sent_at) so that when the new agreement is signed, the
 * completion webhook regenerates and emails a corrected invoice for the
 * new amount instead of skipping (it skips when those are already set).
 */
export async function sendNewAgreementForStageAction(
  id: string,
): Promise<SignatureSendResult> {
  try {
    await requireAdmin();
    if (!isSignatureConfigured()) {
      throw new Error("SIGNATURE_API_KEY missing on the server");
    }
    const supabase = await createClient();

    // Clear the invoice gate FIRST so the regenerated agreement's
    // completion produces a fresh invoice at the new amount.
    // sendSignatureRequest's own stage update (below) doesn't touch
    // these columns, so they stay null until the next completion.
    await supabase
      .from("stages")
      .update({ invoice_pdf_url: null, invoice_sent_at: null })
      .eq("id", id);

    // Rebuild PDF from current stage data + create a new envelope.
    // sendSignatureFromStage resets signature_completed_at /
    // signed_pdf_url / status and overwrites signature_envelope_id.
    await sendSignatureRequest(id);

    revalidatePath(`/stages/${id}`);
    return { ok: true };
  } catch (e: any) {
    console.error("sendNewAgreementForStageAction failed:", e);
    return {
      ok: false,
      error: e?.message || "Failed to send new agreement",
    };
  }
}

/**
 * Pulls the current envelope status from SignatureAPI and writes it back
 * to the stage. Used as a fallback when a webhook is missed or arrives
 * out of order (so the stage page doesn't get stuck showing "Sent" /
 * "Processing" forever).
 */
export type SignatureSyncResult =
  | {
      ok: true;
      status: string;
      envelopeStatus?: string;
      recipients?: { email?: string; status?: string }[];
    }
  | { ok: false; error: string };

export async function syncSignatureStatusAction(
  stageId: string
): Promise<SignatureSyncResult> {
  try {
    if (!isSignatureConfigured()) {
      throw new Error("SIGNATURE_API_KEY missing on the server");
    }
    const supabase = await createClient();
    const { data: stage } = await supabase
      .from("stages")
      .select("id, signature_envelope_id")
      .eq("id", stageId)
      .single();
    if (!stage?.signature_envelope_id) {
      throw new Error("This stage has no signature envelope yet");
    }

    const envelope = await getEnvelope(stage.signature_envelope_id);
    // Log the whole payload so we can see exactly what SignatureAPI is
    // returning when the UI seems stuck. Visible in Vercel runtime logs.
    console.log("[signature sync] envelope payload:", JSON.stringify(envelope));
    const rawStatus = String(envelope.status || "").toLowerCase();

    // Some envelopes sit at "in_progress" briefly after the signer is
    // actually done while SignatureAPI generates the deliverable. Look
    // at the recipients array too — if every signer/approver is
    // "completed", we can confidently mark the contract as signed.
    const recipientsRaw = (envelope as unknown as { recipients?: unknown })
      .recipients;
    const recipients: {
      status?: string;
      type?: string;
      email?: string;
    }[] = Array.isArray(recipientsRaw)
      ? (recipientsRaw as { status?: string; type?: string; email?: string }[])
      : [];
    const signers = recipients.filter(
      (r) => !r.type || r.type === "signer" || r.type === "approver"
    );
    const allRecipientsComplete =
      signers.length > 0 &&
      signers.every((r) => String(r.status || "").toLowerCase() === "completed");

    const isCompleted =
      rawStatus === "completed" ||
      rawStatus === "signed" ||
      rawStatus.includes("complete") ||
      allRecipientsComplete;

    const update: Record<string, unknown> = {
      signature_status: isCompleted ? "signed" : rawStatus || "unknown",
    };

    if (isCompleted) {
      update.signature_completed_at = new Date().toISOString();
      // Cache the signed PDF if we haven't already.
      try {
        const bytes = await downloadSignedPdf(stage.signature_envelope_id);
        if (bytes) {
          const path = `signed/${stage.signature_envelope_id}.pdf`;
          await supabase.storage
            .from("contracts")
            .upload(path, bytes, {
              contentType: "application/pdf",
              upsert: true,
            });
          const { data: urlData } = supabase.storage
            .from("contracts")
            .getPublicUrl(path);
          update.signed_pdf_url = urlData.publicUrl;
        }
      } catch (e) {
        console.warn("Signed PDF cache during sync failed:", e);
      }
    }

    const { error } = await supabase
      .from("stages")
      .update(update)
      .eq("id", stageId);
    if (error) throw new Error(error.message);

    // Auto-generate the invoice the first time we detect a signed
    // signature. Best-effort: if it fails we still report the sync
    // result as successful; the admin can hit Generate manually.
    if (isCompleted) {
      try {
        const { data: stageRow } = await supabase
          .from("stages")
          .select("invoice_pdf_url")
          .eq("id", stageId)
          .single();
        if (!stageRow?.invoice_pdf_url) {
          await generateInvoiceFor(supabase, stageId);
        }
      } catch (e) {
        console.warn("Auto-invoice after signature sync failed:", e);
      }
    }

    revalidatePath(`/stages/${stageId}`);
    return {
      ok: true,
      status: String(update.signature_status),
      envelopeStatus: rawStatus || undefined,
      recipients: recipients.map((r) => ({
        email: r.email,
        status: r.status,
      })),
    };
  } catch (e: any) {
    console.error("syncSignatureStatusAction failed:", e);
    return { ok: false, error: e?.message || "Sync failed" };
  }
}

/**
 * Admin escape hatch: mark a stage's signature as completed manually,
 * regardless of what SignatureAPI says. Used when the signer confirms
 * out-of-band (text/phone) that they signed but webhooks / status sync
 * are stuck.
 */
export async function markSignatureSignedAction(
  stageId: string
): Promise<SignatureSyncResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not signed in");
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (profile?.role !== "admin") throw new Error("Admin only");

    const update: Record<string, unknown> = {
      signature_status: "signed",
      signature_completed_at: new Date().toISOString(),
    };

    // Best-effort: try to cache the PDF in case it's ready.
    const { data: stage } = await supabase
      .from("stages")
      .select("signature_envelope_id")
      .eq("id", stageId)
      .single();
    if (stage?.signature_envelope_id && isSignatureConfigured()) {
      try {
        const bytes = await downloadSignedPdf(stage.signature_envelope_id);
        if (bytes) {
          const path = `signed/${stage.signature_envelope_id}.pdf`;
          await supabase.storage.from("contracts").upload(path, bytes, {
            contentType: "application/pdf",
            upsert: true,
          });
          const { data: urlData } = supabase.storage
            .from("contracts")
            .getPublicUrl(path);
          update.signed_pdf_url = urlData.publicUrl;
        }
      } catch (e) {
        console.warn("manual mark: signed PDF download failed:", e);
      }
    }

    const { error } = await supabase
      .from("stages")
      .update(update)
      .eq("id", stageId);
    if (error) throw new Error(error.message);

    // Auto-fire the invoice if it hasn't been generated yet.
    try {
      const { data: stageRow } = await supabase
        .from("stages")
        .select("invoice_pdf_url")
        .eq("id", stageId)
        .single();
      if (!stageRow?.invoice_pdf_url) {
        await generateInvoiceFor(supabase, stageId);
      }
    } catch (e) {
      console.warn("Auto-invoice after manual mark-as-signed failed:", e);
    }

    revalidatePath(`/stages/${stageId}`);
    return { ok: true, status: "signed" };
  } catch (e: any) {
    console.error("markSignatureSignedAction failed:", e);
    return { ok: false, error: e?.message || "Mark-as-signed failed" };
  }
}

/**
 * Admin-only: attach a signed PDF manually. Used when the envelope's
 * webhook missed, the envelope_id in the DB doesn't match the one
 * actually signed, or you're working from a paper-then-scanned copy.
 *
 * Stores it in the same `contracts` bucket the auto-download uses,
 * under a stage-scoped path so multiple manual uploads on the same
 * stage don't collide.
 */
export type AttachPdfResult = { ok: true; url: string } | { ok: false; error: string };

export async function attachSignedPdfAction(
  stageId: string,
  formData: FormData
): Promise<AttachPdfResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not signed in");
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (profile?.role !== "admin") throw new Error("Admin only");

    const file = formData.get("file") as File | null;
    if (!file || file.size === 0) throw new Error("No file provided");
    if (file.size > 25 * 1024 * 1024) {
      throw new Error("PDF too large (>25 MB)");
    }
    const ct = file.type || "application/pdf";
    if (!ct.includes("pdf")) {
      throw new Error("Expected a PDF (got " + ct + ")");
    }

    const path = `signed/${stageId}-${Date.now()}.pdf`;
    const { error: upErr } = await supabase.storage
      .from("contracts")
      .upload(path, file, { contentType: "application/pdf", upsert: false });
    if (upErr) throw new Error(upErr.message);

    const { data: urlData } = supabase.storage
      .from("contracts")
      .getPublicUrl(path);

    const { error } = await supabase
      .from("stages")
      .update({
        signed_pdf_url: urlData.publicUrl,
        signature_status: "signed",
        signature_completed_at: new Date().toISOString(),
      })
      .eq("id", stageId);
    if (error) throw new Error(error.message);

    revalidatePath(`/stages/${stageId}`);
    return { ok: true, url: urlData.publicUrl };
  } catch (e: any) {
    console.error("attachSignedPdfAction failed:", e);
    return { ok: false, error: e?.message || "Upload failed" };
  }
}

// ---------- Invoicing ----------

export type GenerateInvoiceResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

/**
 * Build the invoice PDF for a stage and store it in the contracts
 * bucket. Idempotent — running again overwrites the cached PDF and
 * refreshes the stored URL. Admin-only.
 */
export async function generateInvoiceAction(
  stageId: string
): Promise<GenerateInvoiceResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not signed in");
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (profile?.role !== "admin") throw new Error("Admin only");

    const { url } = await generateInvoiceFor(supabase, stageId);
    revalidatePath(`/stages/${stageId}`);
    return { ok: true, url };
  } catch (e: any) {
    console.error("generateInvoiceAction failed:", e);
    return { ok: false, error: e?.message || "Generate failed" };
  }
}

export type SendInvoiceResult =
  | { ok: true; messageId: string }
  | { ok: false; error: string };

/**
 * Email the invoice PDF link to the client on file. Generates the
 * invoice PDF first if one doesn't exist yet. Admin-only.
 *
 * Stamps invoice_sent_at on success so the InvoiceSection can show
 * "Sent on May 21".
 */
export async function sendInvoiceEmailAction(
  stageId: string
): Promise<SendInvoiceResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not signed in");
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (profile?.role !== "admin") throw new Error("Admin only");

    // Delegate to the shared pipeline so the admin-fired send and the
    // webhook's auto-send produce identical emails (same BCC list,
    // same body, same stamping behavior).
    const { sendInvoiceEmailFor } = await import("@/lib/invoice-email-core");
    const r = await sendInvoiceEmailFor(supabase, stageId);
    revalidatePath(`/stages/${stageId}`);
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, messageId: r.messageId };
  } catch (e: any) {
    console.error("sendInvoiceEmailAction failed:", e);
    return { ok: false, error: e?.message || "Send failed" };
  }
}

// (legacy in-line invoice-email body moved to src/lib/invoice-email-core.ts)

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type MarkPaidResult = { ok: true } | { ok: false; error: string };

/**
 * Stamp the stage as paid. Admin-only. `formData` carries:
 *   - method: one of check/cash/zelle/venmo/card/other
 *   - paid_at: ISO date (defaults to today)
 */
/**
 * "Mark paid in full." Inserts a single payment row for the
 * OUTSTANDING balance (so it correctly closes out a stage with prior
 * partial payments). The DB trigger on `stage_payments` then updates
 * `stages.paid_at` to the new payment's date.
 */
export async function markPaidAction(
  stageId: string,
  formData: FormData
): Promise<MarkPaidResult> {
  try {
    await requireAdmin();
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not signed in");

    const { data: stage } = await supabase
      .from("stages")
      .select("amount, paid_at")
      .eq("id", stageId)
      .single();
    if (!stage) throw new Error("Stage not found");

    const { data: prior } = await supabase
      .from("stage_payments")
      .select("amount")
      .eq("stage_id", stageId);
    const paidSoFar = (prior ?? []).reduce(
      (sum, p: any) => sum + Number(p.amount || 0),
      0,
    );
    const outstanding =
      Math.max(Number(stage.amount ?? 0) - paidSoFar, 0);

    const methodRaw = String(formData.get("method") || "").toLowerCase();
    const allowed = ["check", "cash", "zelle", "venmo", "card", "other"];
    const method = allowed.includes(methodRaw) ? methodRaw : "other";
    const paidAtRaw = String(formData.get("paid_at") || "").trim();
    const paidAt = /^\d{4}-\d{2}-\d{2}$/.test(paidAtRaw)
      ? paidAtRaw
      : new Date().toISOString().slice(0, 10);

    if (outstanding <= 0) {
      // Nothing to add to the payments ledger — either already paid in
      // full, or the stage's amount is $0 (legacy imports with no price
      // on file). The stage_payments trigger only stamps stages.paid_at
      // when a payment ROW exists (stage_payments has CHECK amount > 0,
      // so a $0 payment can't be inserted) — so a $0 stage would sit in
      // "Outstanding" forever while this action reported success. Stamp
      // the stage directly instead.
      if (!stage.paid_at) {
        const { error } = await supabase
          .from("stages")
          .update({ paid_at: paidAt, payment_method: method })
          .eq("id", stageId);
        if (error) throw new Error(error.message);
        await logActivity(supabase, {
          kind: "payment_recorded",
          stageId,
          details: { amount: 0, method, paid_at: paidAt, via: "mark_paid" },
        });
        revalidatePath(`/stages/${stageId}`);
        revalidatePath("/");
      }
      // Idempotent success on re-clicks either way.
      return { ok: true };
    }

    const { error } = await supabase.from("stage_payments").insert({
      stage_id: stageId,
      amount: outstanding,
      paid_at: paidAt,
      method,
      created_by: user.id,
    });
    if (error) throw new Error(error.message);

    await logActivity(supabase, {
      kind: "payment_recorded",
      stageId,
      details: { amount: outstanding, method, paid_at: paidAt, via: "mark_paid" },
    });

    revalidatePath(`/stages/${stageId}`);
    revalidatePath("/");
    return { ok: true };
  } catch (e: any) {
    console.error("markPaidAction failed:", e);
    return { ok: false, error: e?.message || "Mark paid failed" };
  }
}

/**
 * "Unmark paid." Removes EVERY payment on the stage so it reverts to
 * unpaid (the trigger nullifies paid_at). Use per-payment delete from
 * the payments ledger to undo a single partial payment instead.
 */
export async function unmarkPaidAction(stageId: string): Promise<MarkPaidResult> {
  try {
    await requireAdmin();
    const supabase = await createClient();
    const { error } = await supabase
      .from("stage_payments")
      .delete()
      .eq("stage_id", stageId);
    if (error) throw new Error(error.message);
    revalidatePath(`/stages/${stageId}`);
    revalidatePath("/");
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Unmark failed" };
  }
}

/**
 * Record a partial (or full) payment against a stage. Admin-only.
 * Inputs from the form: amount, paid_at (YYYY-MM-DD), method, note.
 */
export async function recordStagePaymentAction(
  stageId: string,
  formData: FormData,
): Promise<MarkPaidResult> {
  try {
    await requireAdmin();
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not signed in");

    const amount = Number(formData.get("amount"));
    if (!amount || !Number.isFinite(amount) || amount <= 0) {
      return { ok: false, error: "Enter a positive amount." };
    }
    const paidAtRaw = String(formData.get("paid_at") || "").trim();
    const paidAt = /^\d{4}-\d{2}-\d{2}$/.test(paidAtRaw)
      ? paidAtRaw
      : new Date().toISOString().slice(0, 10);
    const methodRaw = String(formData.get("method") || "").toLowerCase();
    const allowed = ["check", "cash", "zelle", "venmo", "card", "other"];
    const method = allowed.includes(methodRaw) ? methodRaw : null;
    const note = String(formData.get("note") || "").trim() || null;

    const { error } = await supabase.from("stage_payments").insert({
      stage_id: stageId,
      amount,
      paid_at: paidAt,
      method,
      note,
      created_by: user.id,
    });
    if (error) throw new Error(error.message);

    await logActivity(supabase, {
      kind: "payment_recorded",
      stageId,
      details: { amount, method, paid_at: paidAt },
    });

    revalidatePath(`/stages/${stageId}`);
    revalidatePath("/");
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Couldn't record payment." };
  }
}

export type UpdateSecondaryRecipientResult =
  | { ok: true; resentSignature: boolean }
  | { ok: false; error: string };

/**
 * Set / update / remove the secondary signer + payer (homeowner) on a
 * stage after it was created.
 *
 * Form fields (all strings, can be empty for "remove"):
 *   - secondary_recipient_name
 *   - secondary_recipient_email
 *
 * If a signature envelope was already sent for this stage and the
 * secondary contact info actually changed, we auto-re-trigger the
 * signature send so the new envelope includes both signers. Errors
 * during the re-send don't roll back the save — the admin can resend
 * manually from the signature card.
 */
export async function updateStageSecondaryRecipientAction(
  stageId: string,
  formData: FormData,
): Promise<UpdateSecondaryRecipientResult> {
  try {
    await requireAdmin();
    const supabase = await createClient();

    const name =
      ((formData.get("secondary_recipient_name") as string) || "").trim();
    const email =
      ((formData.get("secondary_recipient_email") as string) || "")
        .trim()
        .toLowerCase();

    if ((name && !email) || (!name && email)) {
      return {
        ok: false,
        error: "Provide both a name and an email, or leave both blank to remove.",
      };
    }

    const { data: prev } = await supabase
      .from("stages")
      .select(
        "secondary_recipient_name, secondary_recipient_email, signature_envelope_id",
      )
      .eq("id", stageId)
      .single();

    const prevName = (prev?.secondary_recipient_name ?? "") as string;
    const prevEmail = ((prev?.secondary_recipient_email ?? "") as string)
      .toLowerCase();

    const { error } = await supabase
      .from("stages")
      .update({
        secondary_recipient_name: name || null,
        secondary_recipient_email: email || null,
      })
      .eq("id", stageId);
    if (error) throw new Error(error.message);

    // If a signature was already sent AND the secondary recipient
    // actually changed, kick off a fresh envelope so the new signer
    // gets a signing link (and so the contract reflects both names).
    // We don't await in a blocking way — but server actions can't
    // return before completing, so just run it and swallow errors.
    let resentSignature = false;
    const secondaryChanged = name !== prevName || email !== prevEmail;
    if (prev?.signature_envelope_id && secondaryChanged) {
      try {
        await sendSignatureFromStage(supabase, stageId);
        resentSignature = true;
      } catch (e) {
        console.error(
          "[updateStageSecondaryRecipientAction signature resend]",
          e,
        );
      }
    }

    revalidatePath(`/stages/${stageId}`);
    return { ok: true, resentSignature };
  } catch (e: any) {
    console.error("updateStageSecondaryRecipientAction:", e);
    return { ok: false, error: e?.message || "Save failed" };
  }
}

/** Remove a single payment row (typo / wrong amount). Admin-only. */
export async function deleteStagePaymentAction(
  paymentId: string,
  stageId: string,
): Promise<MarkPaidResult> {
  try {
    await requireAdmin();
    const supabase = await createClient();
    const { error } = await supabase
      .from("stage_payments")
      .delete()
      .eq("id", paymentId);
    if (error) throw new Error(error.message);
    revalidatePath(`/stages/${stageId}`);
    revalidatePath("/");
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Delete failed" };
  }
}

export async function updateStageAction(id: string, formData: FormData) {
  const supabase = await createClient();
  // Read pre-update status + dates so we know
  //   (a) whether to fire a status-change notification, and
  //   (b) whether to auto-recompute destage_date when stage_date moves.
  const { data: prev } = await supabase
    .from("stages")
    .select("status, stage_date, destage_date, stage_length_days")
    .eq("id", id)
    .single();
  const pricing = parsePricingFromForm(formData);
  const stageDate = (formData.get("stage_date") as string) || null;
  const submittedDestage =
    (formData.get("destage_date") as string) || null;
  // Always honor the explicit stage_length_days/extended_stage field
  // if the form sent one; otherwise keep whatever the row has.
  const stageLengthDays =
    formData.get("stage_length_days") != null ||
    formData.get("extended_stage") != null
      ? parseStageLengthFromForm(formData)
      : normalizeStageLength(prev?.stage_length_days ?? 60);
  // If the user changed stage_date and left destage_date alone (still
  // matches the old destage on file), bump destage_date forward so it
  // stays at the configured stage length. If they explicitly typed a
  // new destage_date, honor it.
  const stageDateChanged =
    !!stageDate && stageDate !== (prev?.stage_date ?? null);
  const destageUnchanged =
    submittedDestage === (prev?.destage_date ?? null);
  const destageDate =
    stageDateChanged && destageUnchanged
      ? defaultDestage(stageDate, null, stageLengthDays)
      : defaultDestage(stageDate, submittedDestage, stageLengthDays);
  const payload = {
    address: String(formData.get("address") || "").trim(),
    amount: pricing.amount,
    package_key: pricing.packageKey,
    add_ons: pricing.addOns,
    discount: pricing.discount,
    escrow: pricing.escrow,
    travel_fee: pricing.travelFee,
    line_items: pricing.lineItems,
    stage_date: stageDate,
    destage_date: destageDate,
    stage_length_days: stageLengthDays,
    notes: (formData.get("notes") as string) || null,
    status: (formData.get("status") as string) || "scheduled",
    lockbox_code: (formData.get("lockbox_code") as string)?.trim() || null,
    city: (formData.get("city") as string)?.trim() || null,
    square_footage: parseIntOrNull(formData.get("square_footage")),
    bedrooms: parseIntOrNull(formData.get("bedrooms")),
    bathrooms: parseFloatOrNull(formData.get("bathrooms")),
    zillow_url: ((formData.get("zillow_url") as string) || "").trim() || null,
    primary_only:
      formData.get("primary_only") === "on" ||
      formData.get("primary_only") === "true",
    secondary_recipient_name:
      ((formData.get("secondary_recipient_name") as string) || "").trim() ||
      null,
    secondary_recipient_email:
      ((formData.get("secondary_recipient_email") as string) || "")
        .trim()
        .toLowerCase() || null,
  };
  // Don't require a package on update — many imported (Trello) stages
  // have no package_key on file and editing one of those should still
  // be allowed. The 'New stage' flow keeps the strict check since that
  // path is always typed in fresh.
  const { error } = await supabase.from("stages").update(payload).eq("id", id);
  if (error) throw new Error(error.message);
  // NO revalidatePath here. Revalidating the current route makes Next
  // auto-refresh the page the user is on — re-rendering the heavy stage
  // route and re-suspending its photo/payment/extension sections into
  // their skeletons. THAT is the post-save "loading screen". Editing is a
  // client-side toggle now, so we don't need a server re-render to leave
  // edit mode. Lists/other views refresh on their own staleTime (60s) or
  // next visit; the detail view picks up saved values on its next fetch.
  // Slow side effects (Twilio + activity-log inserts) run AFTER the
  // response so the redirect lands instantly. Each is gated to status-
  // change edits, since plain field edits don't need either.
  const statusChanged = !!prev?.status && prev.status !== payload.status;
  if (statusChanged) {
    after(async () => {
      try {
        await logActivity(supabase, {
          kind: "stage_status_change",
          stageId: id,
          details: { from: prev!.status, to: payload.status, via: "edit_form" },
        });
      } catch (e) {
        console.error("[updateStageAction logActivity]", e);
      }
      try {
        await notifyStatusChange({
          stageId: id,
          oldStatus: prev!.status,
          newStatus: payload.status,
        });
      } catch (notifyErr) {
        console.error("[notify] update failed:", notifyErr);
      }
    });
  }
  // Leaving edit mode is handled CLIENT-SIDE by StageEditClient (instant
  // toggle, no navigation or router.refresh — that route re-render was the
  // post-save "loading screen"). This revalidate keeps the route fresh for
  // the next time it's fetched (navigate away/back, pull-to-refresh).
}

/**
 * Admin-only stage delete. Also cleans up the photos and contract PDFs
 * that live in storage (the DB rows cascade via FK on delete; storage
 * blobs do not). Storage cleanup is best-effort — we don't block the
 * delete on storage errors so a half-orphaned bucket can't strand the
 * user.
 */
export async function deleteStageAction(id: string) {
  const supabase = await createClient();

  // Server-side admin guard so the action can't be POSTed by anyone.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") throw new Error("Admin only");

  // 1. Best-effort cleanup of photos in the stage-photos bucket.
  try {
    const { data: photos } = await supabase
      .from("stage_photos")
      .select("storage_path")
      .eq("stage_id", id);
    const paths = (photos ?? [])
      .map((p) => p.storage_path)
      .filter(Boolean) as string[];
    if (paths.length > 0) {
      await supabase.storage.from("stage-photos").remove(paths);
    }
  } catch (e) {
    console.warn("deleteStageAction: photo cleanup skipped:", e);
  }

  // 2. Best-effort cleanup of contract PDFs under contracts/{stage_id}/*.
  try {
    const { data: contracts } = await supabase.storage
      .from("contracts")
      .list(id, { limit: 100 });
    if (contracts && contracts.length > 0) {
      const paths = contracts.map((f) => `${id}/${f.name}`);
      await supabase.storage.from("contracts").remove(paths);
    }
  } catch (e) {
    console.warn("deleteStageAction: contract cleanup skipped:", e);
  }

  // Snapshot the address BEFORE deleting so the activity log entry
  // still has it (the FK is on delete set null).
  const { data: snap } = await supabase
    .from("stages")
    .select("address")
    .eq("id", id)
    .maybeSingle();

  // 3. Delete the stage. FK cascade handles stage_tasks + stage_photos rows.
  const { error } = await supabase.from("stages").delete().eq("id", id);
  if (error) throw new Error(error.message);

  await logActivity(supabase, {
    kind: "stage_deleted",
    stageId: null,
    stageAddress: snap?.address ?? null,
  });

  revalidatePath("/stages");
  revalidatePath("/stages/board");
  redirect("/stages");
}

/** Upload a single photo file to storage + insert its metadata row. Shared
 *  by the New Stage batch upload and the per-stage upload form.
 *
 *  `clientKey` (from the offline outbox / uploader) makes the storage
 *  path deterministic so a RETRY of the same photo collides on upload
 *  ("resource already exists") instead of silently inserting a
 *  duplicate — flaky-connection re-sends and multi-tab drains then
 *  fail loudly and get treated as already-delivered. */
async function saveStagePhoto(
  stageId: string,
  file: File,
  caption: string | null,
  clientKey?: string | null,
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const safeKey = (clientKey ?? "").replace(/[^a-zA-Z0-9-]/g, "");
  const path = safeKey
    ? `${stageId}/ob-${safeKey}-${safeName}`
    : `${stageId}/${Date.now()}-${safeName}`;
  const { error: upErr } = await supabase.storage
    .from("stage-photos")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) throw new Error(upErr.message);
  const { error } = await supabase.from("stage_photos").insert({
    stage_id: stageId,
    storage_path: path,
    caption,
    media_type: "image",
    uploaded_by: user?.id ?? null,
  });
  if (error) throw new Error(error.message);
}

/**
 * Record a video that the browser uploaded DIRECTLY to the stage-photos
 * bucket. Videos can't go through the photo server action like images do
 * — they routinely exceed Vercel's ~4.5 MB request-body limit — so the
 * client uploads the file straight to Storage with the user's session and
 * then calls this to insert the metadata row. We don't move any bytes
 * here; we just validate the path and stamp the row as a video.
 */
export async function attachStageVideoAction(
  stageId: string,
  storagePath: string,
) {
  const { userId } = await requireTeamMember();
  // The client builds the path as `${stageId}/...`; reject anything that
  // doesn't live under this stage so a row can't be pointed elsewhere.
  if (!storagePath || !storagePath.startsWith(`${stageId}/`)) {
    throw new Error("Invalid upload path");
  }
  const supabase = await createClient();
  const { error } = await supabase.from("stage_photos").insert({
    stage_id: stageId,
    storage_path: storagePath,
    media_type: "video",
    uploaded_by: userId,
  });
  if (error) throw new Error(error.message);
  await logActivity(supabase, {
    kind: "photo_added",
    stageId,
    details: { count: 1, media: "video" },
  });
  revalidatePath(`/stages/${stageId}`);
}

export async function uploadStagePhotoAction(stageId: string, formData: FormData) {
  const file = formData.get("file") as File | null;
  const caption = (formData.get("caption") as string) || null;
  const clientKey = (formData.get("client_key") as string) || null;
  if (!file || file.size === 0) throw new Error("No file");
  await saveStagePhoto(stageId, file, caption, clientKey);
  const supabase = await createClient();
  await logActivity(supabase, {
    kind: "photo_added",
    stageId,
    details: { count: 1 },
  });
  revalidatePath(`/stages/${stageId}`);
}

export async function updateStageStatusAction(
  id: string,
  status: string,
  via: string = "board_drag",
) {
  // Any team member (admin / stager / lead_stager) can change a stage's
  // status in any direction — this is the "move it back" path for an
  // accidental advance. Non-team users are redirected out.
  await requireTeamMember();
  const allowed = ["scheduled", "staged", "destaged", "completed", "cancelled"];
  if (!allowed.includes(status)) throw new Error("Invalid status");
  const supabase = await createClient();
  const { data: prev } = await supabase
    .from("stages")
    .select("status")
    .eq("id", id)
    .maybeSingle();
  const { error } = await supabase.from("stages").update({ status }).eq("id", id);
  if (error) throw new Error(error.message);
  if (prev?.status && prev.status !== status) {
    await logActivity(supabase, {
      kind: "stage_status_change",
      stageId: id,
      details: { from: prev.status, to: status, via },
    });
  }
  revalidatePath("/stages/board");
  revalidatePath("/stages");
  revalidatePath(`/stages/${id}`);
}

/**
 * Reassign a stage to a different client. Admin-only — the client tie
 * drives billing, contracts, and portal visibility. Invoices/contracts
 * generated AFTER the change pick up the new client automatically (they
 * join clients at generation time); anything already generated or sent
 * keeps the old client's details until regenerated.
 */
export async function updateStageClientAction(
  stageId: string,
  clientId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin();
  const supabase = await createClient();
  // Validate the target client exists (and snapshot names for the log).
  const [{ data: newClient }, { data: stage }] = await Promise.all([
    supabase.from("clients").select("id, name").eq("id", clientId).maybeSingle(),
    supabase
      .from("stages")
      .select("client_id, address, clients(name)")
      .eq("id", stageId)
      .maybeSingle(),
  ]);
  if (!newClient) return { ok: false, error: "Client not found." };
  if (!stage) return { ok: false, error: "Stage not found." };
  if (stage.client_id === clientId) return { ok: true };

  const { error } = await supabase
    .from("stages")
    .update({ client_id: clientId })
    .eq("id", stageId);
  if (error) return { ok: false, error: error.message };

  const prevClient = Array.isArray(stage.clients)
    ? stage.clients[0]
    : stage.clients;
  await logActivity(supabase, {
    kind: "stage_client_change",
    stageId,
    stageAddress: stage.address,
    details: {
      from: (prevClient as { name?: string } | null)?.name ?? null,
      to: newClient.name,
    },
  });
  revalidatePath(`/stages/${stageId}`);
  revalidatePath("/stages");
  revalidatePath("/clients");
  return { ok: true };
}

/**
 * Set (or clear) the photographer arrival time for a stage — the
 * deadline the staging work must beat. Admin-only; stagers and lead
 * stagers see it (with a countdown) on the stage page. The client
 * converts its datetime-local input to ISO/UTC before calling, so DST
 * is already handled.
 */
export async function updatePhotographerAtAction(
  stageId: string,
  iso: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin();
  let value: string | null = null;
  if (iso != null && iso !== "") {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      return { ok: false, error: "Invalid date/time." };
    }
    value = d.toISOString();
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("stages")
    .update({ photographer_at: value })
    .eq("id", stageId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/stages/${stageId}`);
  return { ok: true };
}

/**
 * Inline single-field autosave for the stage detail page (admin only).
 * Whitelisted to operational fields — stage_date, destage_date,
 * lockbox_code, notes. Editing stage_date keeps the destage_date
 * linked at +60 days when destage was the auto-derived value (matches
 * the full edit form's behavior).
 */
export async function updateStageFieldAction(
  stageId: string,
  field: "stage_date" | "destage_date" | "lockbox_code" | "notes",
  value: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ALLOWED = ["stage_date", "destage_date", "lockbox_code", "notes"];
  if (!ALLOWED.includes(field)) {
    return { ok: false, error: "Field not editable." };
  }
  try {
    // Lockbox code and notes are editable by any INTERNAL team member
    // (stagers/lead stagers update the code and add access notes from
    // the field). Dates stay admin-only.
    //
    // Authorization is enforced here, not by RLS: the `stages` table has
    // no row-level security, and server actions are directly invocable
    // by anyone with a session (the page redirect doesn't protect them).
    // A logged-in portal client has a valid session but no `profiles`
    // row, so the team-role check below rejects them.
    const supabase = await createClient();
    if (field === "lockbox_code" || field === "notes") {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return { ok: false, error: "Not signed in." };
      const { data: me } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();
      if (!isTeamRole(me?.role)) {
        return { ok: false, error: "Not authorized." };
      }
    } else {
      await requireAdmin();
    }

    // Normalize empties to null for nullable columns.
    const v = value.trim() === "" ? null : value;

    const patch: Record<string, unknown> = { [field]: v };

    // When stage_date changes and destage_date was auto-derived
    // (old destage == old stage + stage_length_days), bump destage to
    // keep the configured rental window. Skip if destage was set
    // independently.
    if (field === "stage_date" && v) {
      const { data: prev } = await supabase
        .from("stages")
        .select("stage_date, destage_date, stage_length_days")
        .eq("id", stageId)
        .single();
      const oldStage = prev?.stage_date ?? null;
      const oldDestage = prev?.destage_date ?? null;
      const len = normalizeStageLength(prev?.stage_length_days ?? 60);
      const wasAutoDerived =
        oldStage && oldDestage
          ? oldDestage === defaultDestage(oldStage, null, len)
          : !oldDestage;
      if (wasAutoDerived) {
        patch.destage_date = defaultDestage(v, null, len);
      }
    }

    const { error } = await supabase
      .from("stages")
      .update(patch)
      .eq("id", stageId);
    if (error) throw new Error(error.message);
    revalidatePath(`/stages/${stageId}`);
    revalidatePath("/stages");
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Save failed" };
  }
}

/**
 * Workflow advancement: scheduled → staged → destaged → completed.
 * Kept module-private — server action files can only export async
 * functions. The client-side button has its own NEXT_LABEL lookup for
 * display purposes.
 */
const NEXT_STATUS: Record<string, string | null> = {
  scheduled: "staged",
  staged: "destaged",
  destaged: "completed",
  completed: null,
  cancelled: null,
};

export type AdvanceStatusResult =
  | { ok: true; newStatus: string }
  | { ok: false; error: string };

/**
 * Advances the stage one step along the workflow:
 *   scheduled → staged → destaged → completed
 * Returns an error if there's no next step (completed / cancelled).
 */
export async function advanceStageStatusAction(
  stageId: string,
  /**
   * Optional extra fields to write alongside the status flip. Used by
   * the "Move to Destages" flow to record the destage_date the user
   * picks in the confirm dialog. Only the keys present are updated —
   * other columns are untouched.
   */
  extra?: { destage_date?: string | null }
): Promise<AdvanceStatusResult> {
  // Team members (admin / stager / lead_stager) advance the workflow.
  // Kept outside the try/catch so a non-team redirect isn't swallowed
  // into an { ok: false } result.
  await requireTeamMember();
  try {
    const supabase = await createClient();
    const { data: stage } = await supabase
      .from("stages")
      .select("status, stage_date, destage_date, stage_length_days")
      .eq("id", stageId)
      .single();
    if (!stage) throw new Error("Stage not found");
    const next = NEXT_STATUS[stage.status];
    if (!next) {
      throw new Error(`No next step from "${stage.status}".`);
    }
    const payload: Record<string, unknown> = { status: next };
    if (extra && "destage_date" in extra) {
      payload.destage_date = extra.destage_date;
    }
    // Moving Upcoming -> Staged: reset destage_date to stage_date +
    // stage_length_days so the rental clock starts fresh from whatever
    // stage_date is on file (handles late stages where the original
    // destage_date was tied to a planning estimate).
    if (
      stage.status === "scheduled" &&
      next === "staged" &&
      stage.stage_date
    ) {
      payload.destage_date = defaultDestage(
        stage.stage_date,
        null,
        normalizeStageLength(stage.stage_length_days ?? 60),
      );
    }
    const { error } = await supabase
      .from("stages")
      .update(payload)
      .eq("id", stageId);
    if (error) throw new Error(error.message);
    revalidatePath(`/stages/${stageId}`);
    revalidatePath("/stages");
    revalidatePath("/stages/board");
    revalidatePath("/stages/groups");
    // Activity log: snapshot who advanced this stage and from/to where.
    await logActivity(supabase, {
      kind: "stage_status_change",
      stageId,
      details: { from: stage.status, to: next },
    });
    // Fire SMS notifications. Wrapped in try/catch so a Twilio outage
    // never breaks the workflow advance — the status change has already
    // landed in the DB; the text is a best-effort side effect.
    try {
      await notifyStatusChange({
        stageId,
        oldStatus: stage.status,
        newStatus: next,
      });
    } catch (notifyErr) {
      console.error("[notify] advance failed:", notifyErr);
    }
    return { ok: true, newStatus: next };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Advance failed" };
  }
}

export async function deleteStagePhotoAction(photoId: string, stageId: string) {
  const supabase = await createClient();
  const { data: photo } = await supabase
    .from("stage_photos")
    .select("storage_path")
    .eq("id", photoId)
    .single();
  if (photo?.storage_path) {
    await supabase.storage.from("stage-photos").remove([photo.storage_path]);
  }
  await supabase.from("stage_photos").delete().eq("id", photoId);
  revalidatePath(`/stages/${stageId}`);
}

/**
 * Toggle which photo is the "main" card image for a stage. Setting
 * one photo as primary clears it on every sibling (unique index
 * enforces only-one). Re-clicking the current primary clears it,
 * which lets the stage fall back to "earliest photo by created_at".
 *
 * After the write, stages.first_photo_storage_path is refreshed via
 * the same helper the upload trigger uses, so the card thumbnail on
 * the dashboard / board / groups picks up the new pick immediately.
 *
 * Admin-only — Stagers and Lead Stagers can shoot + upload but
 * choosing the cover is a curatorial decision we leave to admins.
 */
export async function setStagePrimaryPhotoAction(
  photoId: string,
  stageId: string,
): Promise<{ ok: true; isPrimary: boolean } | { ok: false; error: string }> {
  try {
    // Any team member (admin / stager / lead stager) can star a photo.
    await requireTeamMember();
    const supabase = await createClient();

    // Was this photo already the primary? Toggle behavior.
    const { data: cur } = await supabase
      .from("stage_photos")
      .select("is_primary, stage_id")
      .eq("id", photoId)
      .single();
    if (!cur || cur.stage_id !== stageId) {
      return { ok: false, error: "Photo not found." };
    }
    const willBePrimary = !cur.is_primary;

    // Clear any existing primary on this stage first (the unique
    // partial index would otherwise reject our INSERT/UPDATE).
    const { error: clearErr } = await supabase
      .from("stage_photos")
      .update({ is_primary: false })
      .eq("stage_id", stageId)
      .eq("is_primary", true);
    if (clearErr) throw new Error(clearErr.message);

    if (willBePrimary) {
      const { error } = await supabase
        .from("stage_photos")
        .update({ is_primary: true })
        .eq("id", photoId);
      if (error) throw new Error(error.message);
    }

    // Refresh the cached first_photo_storage_path on stages so the
    // card thumbnails everywhere else pick up the new pick.
    await supabase.rpc("refresh_stage_first_photo", { p_stage_id: stageId });

    revalidatePath(`/stages/${stageId}`);
    revalidatePath("/");
    revalidatePath("/stages");
    revalidatePath("/stages/board");
    revalidatePath("/stages/groups");
    return { ok: true, isPrimary: willBePrimary };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Couldn't set main photo." };
  }
}

/**
 * Mark the latest extension invoice as paid (admin only). Stamps
 * extension_invoice_paid_at with right-now and refreshes the stage
 * detail page.
 */
/**
 * Mark a single extension paid (per-row). Mirrors the paid timestamp
 * onto the stages.extension_invoice_paid_at rollup column when the
 * row being updated is the most recent extension, so dashboards that
 * still read the rollup show the right state.
 */
export async function markExtensionPaidAction(
  extensionId: string,
  stageId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const supabase = await createClient();
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("stage_extensions")
      .update({ paid_at: now })
      .eq("id", extensionId);
    if (error) throw new Error(error.message);
    await mirrorLatestExtensionToStage(stageId);
    revalidatePath(`/stages/${stageId}`);
    // Also used from the dashboard's Outstanding extensions section.
    revalidatePath("/");
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Mark paid failed" };
  }
}

export async function unmarkExtensionPaidAction(
  extensionId: string,
  stageId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("stage_extensions")
      .update({ paid_at: null })
      .eq("id", extensionId);
    if (error) throw new Error(error.message);
    await mirrorLatestExtensionToStage(stageId);
    revalidatePath(`/stages/${stageId}`);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Unmark paid failed" };
  }
}

/**
 * Copy the most recent stage_extensions row's amount + paid_at +
 * pdf_url onto the corresponding stages.* rollup columns so any
 * code still reading the old columns sees the latest state.
 */
async function mirrorLatestExtensionToStage(stageId: string): Promise<void> {
  const supabase = await createClient();
  const { data: latest } = await supabase
    .from("stage_extensions")
    .select("amount, paid_at, pdf_url")
    .eq("stage_id", stageId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (!latest) return;
  await supabase
    .from("stages")
    .update({
      extension_invoice_amount: latest.amount,
      extension_invoice_paid_at: latest.paid_at,
      extension_invoice_pdf_url: latest.pdf_url,
    })
    .eq("id", stageId);
}

/**
 * Manually record an extension on a stage. Generates a PDF invoice
 * for the supplied amount, uploads it to Storage, emails it to the
 * client (if email is configured + client has an address on file),
 * and stamps the resulting stage_extensions row with the URL +
 * sent timestamp. Also bumps stages.extension_count and (optionally)
 * pushes destage_date forward + marks paid.
 */
export async function recordManualExtensionAction(
  stageId: string,
  input: {
    amount: number;
    newDestageDate?: string | null;
    paid?: boolean;
    paidAt?: string | null;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return { ok: false, error: "Enter an extension amount." };
    }
    await requireAdmin();
    const supabase = await createClient();
    // Pull stage + client for the PDF + email.
    const { data: stage, error: fetchErr } = await supabase
      .from("stages")
      .select(
        "id, address, city, amount, stage_date, destage_date, extension_count, clients(name, email)",
      )
      .eq("id", stageId)
      .single();
    if (fetchErr) throw new Error(fetchErr.message);

    const paidAtIso = input.paid
      ? input.paidAt
        ? new Date(`${input.paidAt}T12:00:00Z`).toISOString()
        : new Date().toISOString()
      : null;

    // Generate the PDF (best-effort — if it fails we still record
    // the row so the bookkeeping isn't lost).
    let pdfUrl: string | null = null;
    try {
      const { generateExtensionInvoice } = await import(
        "@/lib/extension-core"
      );
      const { url } = await generateExtensionInvoice(stage, amount);
      pdfUrl = url;
    } catch (e) {
      console.error("[recordManualExtension] PDF generation failed:", e);
    }

    // Insert the per-extension history row.
    const newDestage =
      input.newDestageDate ?? (stage as any)?.destage_date ?? null;
    const { data: extRow, error: insErr } = await supabase
      .from("stage_extensions")
      .insert({
        stage_id: stageId,
        extension_date: newDestage,
        amount,
        paid_at: paidAtIso,
        source: "manual",
        pdf_url: pdfUrl,
      })
      .select("id")
      .single();
    if (insErr) throw new Error(insErr.message);
    const extensionRowId: string | null = extRow?.id ?? null;

    // Email the client. Best-effort.
    if (pdfUrl && newDestage) {
      try {
        const { sendExtensionEmailToClient } = await import(
          "@/lib/extension-core"
        );
        const client = Array.isArray((stage as any).clients)
          ? (stage as any).clients[0]
          : (stage as any).clients;
        const sent = await sendExtensionEmailToClient({
          clientName: client?.name ?? null,
          clientEmail: client?.email ?? null,
          address: (stage as any).address,
          newDestage,
          amount,
          invoiceUrl: pdfUrl,
        });
        if (sent && extensionRowId) {
          await supabase
            .from("stage_extensions")
            .update({ pdf_sent_at: new Date().toISOString() })
            .eq("id", extensionRowId);
        }
      } catch (e) {
        console.error("[recordManualExtension] email failed:", e);
      }
    }

    // Mirror rollup columns on stages.
    const patch: Record<string, unknown> = {
      extension_count: ((stage as any)?.extension_count ?? 0) + 1,
      extension_invoice_amount: amount,
      extension_invoice_paid_at: paidAtIso,
      extension_invoice_pdf_url: pdfUrl,
    };
    if (input.newDestageDate) {
      patch.destage_date = input.newDestageDate;
    }
    const { error } = await supabase
      .from("stages")
      .update(patch)
      .eq("id", stageId);
    if (error) throw new Error(error.message);
    revalidatePath(`/stages/${stageId}`);
    revalidatePath("/finance");
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Record extension failed" };
  }
}

/**
 * Delete a single extension. Decrements stages.extension_count and
 * re-mirrors the new latest extension (or clears the rollup
 * columns if no extensions remain).
 */
export async function deleteExtensionAction(
  extensionId: string,
  stageId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireAdmin();
    const supabase = await createClient();
    const { error: delErr } = await supabase
      .from("stage_extensions")
      .delete()
      .eq("id", extensionId);
    if (delErr) throw new Error(delErr.message);

    // Recount + re-mirror.
    const { count } = await supabase
      .from("stage_extensions")
      .select("id", { count: "exact", head: true })
      .eq("stage_id", stageId);
    const remaining = count ?? 0;

    if (remaining === 0) {
      await supabase
        .from("stages")
        .update({
          extension_count: 0,
          extension_invoice_amount: null,
          extension_invoice_paid_at: null,
          extension_invoice_pdf_url: null,
        })
        .eq("id", stageId);
    } else {
      await supabase
        .from("stages")
        .update({ extension_count: remaining })
        .eq("id", stageId);
      await mirrorLatestExtensionToStage(stageId);
    }
    revalidatePath(`/stages/${stageId}`);
    revalidatePath("/finance");
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Delete extension failed" };
  }
}

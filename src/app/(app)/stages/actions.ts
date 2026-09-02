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
import { getContractTemplate } from "@/lib/contract-template";
import { sendSignatureFromStage } from "@/lib/signature-send-core";
import { generateInvoiceFor } from "@/lib/invoice-generate-core";
import { sendEmail, isEmailConfigured } from "@/lib/email-send";
import { emailButton } from "@/lib/email-button";
import { buildStagePricing } from "@/lib/stage-pricing";
import { randomBytes } from "node:crypto";
import {
  isR2Configured,
  isR2Path,
  presignUpload,
  r2Key,
  deleteR2Object,
  R2_PREFIX,
} from "@/lib/r2";
import {
  computePrice,
  normalizeTravelFee,
  parseLineItems,
  sumLineItems,
  type SelectedAddOn,
} from "@/lib/pricing";
import { requireAdmin } from "@/lib/require-admin";
import { addDaysISO, formatMDY } from "@/lib/time";
import { isTeamRole, requireTeamMember } from "@/lib/permissions";
import { notifyStatusChange } from "@/lib/notify";
import {
  type StageLength,
  normalizeStageLength,
} from "@/lib/stage-length";
import { logActivity } from "@/lib/activity-log";
import { parseStagedRooms, stagedRoomLabels } from "@/lib/staged-rooms";

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
  // Travel fee is independent of pricing mode — it adds
  // flat amounts to the saved total and are recorded on the stage
  // (stages.travel_fee).
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
        travelFee,
        lineItems,
        amount: n + travelFee + lineItemsTotal,
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
    travelFee,
    lineItems,
    amount: breakdown.total + travelFee + lineItemsTotal,
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
    // Per-stage billing entity (invoice Bill To). Create-only here —
    // edits happen via the stage page's inline field, so the full edit
    // form can't silently wipe it.
    bill_to: (formData.get("bill_to") as string)?.trim() || null,
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
    staged_rooms: parseStagedRooms(formData.get("staged_rooms")),
    agent_note: ((formData.get("agent_note") as string) || "").trim() || null,
    // Seller-handoff link. Minted up front so the agent's "not yours to
    // sign?" email can carry it; consumed only if they use it.
    handoff_token: randomBytes(24).toString("base64url"),
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
  // No signature goes out yet. The agent first picks who signs — either
  // themselves or their seller — via the emailed choice link. Whichever
  // they choose, that's who gets the agreement and the invoice.
  // Best-effort; the email is resendable from the stage page.
  try {
    await sendSignerChoiceEmail(data.id);
  } catch (e) {
    console.error("[createStageAction] sendSignerChoiceEmail failed:", e);
  }

  revalidatePath("/stages");
  redirect(`/stages/${data.id}`);
}

/**
 * Email the agent (the stage's client) the signer-choice link. They pick
 * either to sign it themselves or to pass it to their seller; only then
 * does the agreement go out. Both email buttons land on the same page —
 * the choice needs an explicit click there, so a link-prefetching mail
 * scanner can never make the decision.
 *
 * Returns false (quietly) when email isn't configured, the choice has
 * already been made, or the agent has no email on file.
 */
export async function sendSignerChoiceEmail(
  stageId: string,
): Promise<boolean> {
  if (!isEmailConfigured()) return false;
  const supabase = await createClient();
  const { data: stage } = await supabase
    .from("stages")
    .select(
      "id, address, city, stage_date, destage_date, stage_length_days, amount, package_key, add_ons, discount, travel_fee, line_items, staged_rooms, agent_note, handoff_token, client:clients(name, email)",
    )
    .eq("id", stageId)
    .single();
  if (!stage?.handoff_token) return false;
  const client = Array.isArray(stage.client) ? stage.client[0] : stage.client;
  const agent = client as { name: string; email: string | null } | null;
  if (!agent?.email) return false;

  const baseUrl = (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    ""
  ).replace(/\/$/, "");
  const link = `${baseUrl}/handoff/${stage.handoff_token}`;
  const firstName = (agent.name || "there").split(/\s+/)[0] || "there";
  const subject = `Staging for ${stage.address} — who should sign?`;

  // Same itemization the contract and invoice print, so the agent sees
  // exactly what's being agreed to before they choose.
  const pricing = buildStagePricing(stage);
  const money = (n: number) =>
    `$${n.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  const propertyLine = [stage.address, stage.city].filter(Boolean).join(", ");
  const dateLines: string[] = [];
  if (stage.stage_date) dateLines.push(`Stage date: ${formatMDY(stage.stage_date)}`);
  if (stage.destage_date)
    dateLines.push(`Destage date: ${formatMDY(stage.destage_date)}`);
  if (stage.stage_length_days)
    dateLines.push(`Rental period: ${stage.stage_length_days} days`);

  const rooms = stagedRoomLabels((stage as any).staged_rooms);
  const agentNote =
    typeof (stage as any).agent_note === "string"
      ? (stage as any).agent_note.trim()
      : "";
  // Same terms the agreement prints, so nothing is a surprise at signing.
  let terms: { title: string; body: string }[] = [];
  try {
    terms = (await getContractTemplate()).terms;
  } catch {
    // Terms are a nice-to-have here — never block the email.
  }

  const itemsText = pricing.lineItems
    .map((li) => `  • ${li.label} — ${money(li.amount)}`)
    .join("\n");
  const discountText =
    pricing.discount > 0 ? `\n  • Discount — -${money(pricing.discount)}` : "";

  const text = `Hi ${firstName},

The staging at ${propertyLine} is booked. Before we send the agreement, let us know who's taking it on:

1) Sign it yourself — you get the agreement and the invoice.
2) Send it to your seller — they sign and pay, and you stay on as the referring agent.

Choose here: ${link}

--- Stage details ---
Property: ${propertyLine}${dateLines.length ? "\n" + dateLines.join("\n") : ""}${
    rooms.length ? `\nRooms staged: ${rooms.join(", ")}` : ""
  }

${itemsText}${discountText}
  Total: ${money(pricing.total)}
${agentNote ? `\nNote: ${agentNote}\n` : ""}${
    terms.length
      ? `\n--- Terms ---\n` +
        terms.map((t, i) => `${i + 1}. ${t.title}. ${t.body}`).join("\n\n") +
        "\n"
      : ""
  }
We'll send the agreement as soon as you pick.

Thanks!
Revive Design Collective`;
  const html = `<!DOCTYPE html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; line-height:1.5; color:#0f172a; max-width:560px; margin:0 auto; padding:24px;">
  <p>Hi ${firstName},</p>
  <p>The staging at <strong>${stage.address}</strong> is booked. Before we send the agreement, let us know who&rsquo;s taking it on.</p>
  ${emailButton({ href: `${link}#self`, label: "I'll sign it myself" })}
  <p style="font-size:13px; color:#64748b; margin-top:-8px;">You receive the agreement and the invoice.</p>
  ${emailButton({ href: `${link}#seller`, label: "Send it to my seller", bg: "#5f6b5a" })}
  <p style="font-size:13px; color:#64748b; margin-top:-8px;">They sign and pay &mdash; you stay on as the referring agent.</p>
  <p style="font-size:13px; color:#64748b;">The agreement goes out as soon as you choose. Nothing is sent before that.</p>

  <div style="border:1px solid #e2e8f0; border-radius:10px; padding:16px; margin:24px 0;">
    <div style="font-size:12px; text-transform:uppercase; letter-spacing:0.05em; color:#64748b; margin-bottom:10px;">Stage details</div>
    <div style="font-weight:600; color:#0f172a;">${propertyLine}</div>
    ${
      dateLines.length
        ? `<div style="font-size:13px; color:#475569; margin-top:4px;">${dateLines.join(" &middot; ")}</div>`
        : ""
    }
    ${
      rooms.length
        ? `<div style="font-size:13px; color:#475569; margin-top:8px;"><strong>Rooms staged:</strong> ${rooms.join(", ")}</div>`
        : ""
    }
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:14px; font-size:14px;">
      ${pricing.lineItems
        .map(
          (li) =>
            `<tr><td style="padding:4px 0; color:#334155;">${li.label}</td><td style="padding:4px 0; text-align:right; color:#0f172a; white-space:nowrap;">${money(li.amount)}</td></tr>`,
        )
        .join("")}
      ${
        pricing.discount > 0
          ? `<tr><td style="padding:4px 0; color:#334155;">Discount</td><td style="padding:4px 0; text-align:right; color:#0f172a; white-space:nowrap;">-${money(pricing.discount)}</td></tr>`
          : ""
      }
      <tr><td colspan="2" style="border-top:1px solid #e2e8f0; padding-top:8px;"></td></tr>
      <tr><td style="padding:4px 0; font-weight:600; color:#0f172a;">Total</td><td style="padding:4px 0; text-align:right; font-weight:600; color:#0f172a; white-space:nowrap;">${money(pricing.total)}</td></tr>
    </table>
  </div>

  ${
    agentNote
      ? `<div style="border-left:3px solid #7c8b76; padding:2px 0 2px 12px; margin:20px 0; font-size:14px; color:#334155;"><strong>Note:</strong> ${agentNote}</div>`
      : ""
  }

  ${
    terms.length
      ? `<div style="margin:24px 0;">
    <div style="font-size:12px; text-transform:uppercase; letter-spacing:0.05em; color:#64748b; margin-bottom:10px;">Terms</div>
    <ol style="margin:0; padding-left:20px; font-size:13px; color:#475569; line-height:1.6;">
      ${terms
        .map(
          (t) =>
            `<li style="margin-bottom:8px;"><strong style="color:#0f172a;">${t.title}.</strong> ${t.body}</li>`,
        )
        .join("")}
    </ol>
  </div>`
      : ""
  }

  <p style="font-size:12px; color:#94a3b8;">Revive Design Collective</p>
</body></html>`;
  try {
    await sendEmail({ to: agent.email, subject, text, html });
    return true;
  } catch (e) {
    console.error("[sendSignerChoiceEmail] failed:", e);
    return false;
  }
}

/** Admin action: re-send the agent's signer-choice email. */
export async function resendHandoffEmailAction(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireAdmin();
    const sent = await sendSignerChoiceEmail(id);
    if (!sent) {
      return {
        ok: false,
        error:
          "Couldn't send — the agent may have already chosen, or has no email on file.",
      };
    }
    revalidatePath(`/stages/${id}`);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Failed to resend" };
  }
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
/**
 * Switch a stage to the 90-day term. Sets destage_date to
 * stage_date + 90 and stage_length_days to 90 (price unchanged), then
 * rides sendNewAgreementForStageAction: the client gets a fresh
 * agreement showing the 90-day term + new destage date, and when they
 * sign it the webhook regenerates + emails a fresh invoice with the
 * new dates at the same amount (the invoice gate is cleared, so the
 * old PDF can't be re-delivered).
 */
export async function changeStageTo90DaysAction(
  stageId: string,
): Promise<
  { ok: true; newDestage: string } | { ok: false; error: string }
> {
  try {
    await requireAdmin();
    const supabase = await createClient();
    const { data: stage, error } = await supabase
      .from("stages")
      .select("id, stage_date, stage_length_days")
      .eq("id", stageId)
      .single();
    if (error) throw new Error(error.message);
    if (!stage?.stage_date) {
      return {
        ok: false,
        error: "Set a stage date first — the 90-day term counts from it.",
      };
    }
    if (Number(stage.stage_length_days) === 90) {
      return { ok: false, error: "This stage is already on the 90-day term." };
    }
    const newDestage = addDaysISO(String(stage.stage_date), 90);
    const { error: upErr } = await supabase
      .from("stages")
      .update({ stage_length_days: 90, destage_date: newDestage })
      .eq("id", stageId);
    if (upErr) throw new Error(upErr.message);

    const sent = await sendNewAgreementForStageAction(stageId);
    if (!sent.ok) {
      // Term + destage already changed — say so honestly; the Signature
      // card's "Send new agreement" retries the send half.
      return {
        ok: false,
        error: `Term changed to 90 days (destage ${formatMDY(newDestage)}), but the new agreement failed to send: ${sent.error}. Use "Send new agreement" to retry.`,
      };
    }
    revalidatePath("/");
    return { ok: true, newDestage };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Change failed" };
  }
}

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
    travel_fee: pricing.travelFee,
    line_items: pricing.lineItems,
    staged_rooms: parseStagedRooms(formData.get("staged_rooms")),
    agent_note: ((formData.get("agent_note") as string) || "").trim() || null,
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
    const allPaths = (photos ?? [])
      .map((p) => p.storage_path)
      .filter(Boolean) as string[];
    const paths = allPaths.filter((p) => !isR2Path(p));
    if (paths.length > 0) {
      await supabase.storage.from("stage-photos").remove(paths);
    }
    // Videos live in R2 — delete those individually.
    await Promise.all(
      allPaths
        .filter(isR2Path)
        .map((p) =>
          deleteR2Object(r2Key(p)).catch((e) =>
            console.error("[r2] delete failed:", e),
          ),
        ),
    );
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
/**
 * Mint a presigned R2 upload URL for a stage video. The browser PUTs the
 * file straight to R2 (bytes never touch our server), then calls
 * attachStageVideoAction with the returned storagePath.
 *
 * Returns null when R2 isn't configured — the caller then falls back to
 * uploading into Supabase Storage.
 */
export async function createVideoUploadUrlAction(
  stageId: string,
  fileName: string,
  contentType: string,
): Promise<{ uploadUrl: string; storagePath: string } | null> {
  await requireTeamMember();
  if (!isR2Configured()) return null;
  const safe = (fileName || "video").replace(/[^a-zA-Z0-9._-]/g, "_");
  const key = `${stageId}/${Date.now()}-${safe}`;
  const uploadUrl = await presignUpload(key, contentType || "video/mp4");
  return { uploadUrl, storagePath: `${R2_PREFIX}${key}` };
}

export async function attachStageVideoAction(
  stageId: string,
  storagePath: string,
) {
  const { userId } = await requireTeamMember();
  // The client builds the path as `${stageId}/...` (optionally behind the
  // r2: marker); reject anything that doesn't live under this stage so a
  // row can't be pointed elsewhere.
  const rawPath = isR2Path(storagePath) ? r2Key(storagePath) : storagePath;
  if (!storagePath || !rawPath.startsWith(`${stageId}/`)) {
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

export type BatchSendResult =
  | {
      ok: true;
      sent: number;
      failed: Array<{ address: string; error: string }>;
      /** Eligible stages still waiting after this chunk (includes the
       *  failures — the client stops looping when a chunk sends 0). */
      remaining: number;
    }
  | { ok: false; error: string };

/**
 * Send invoices for every unpaid stage that never had one emailed —
 * the backlog catch-up for stages that slipped through the signature
 * gate. Processes a small chunk per call (PDF generation + Resend per
 * stage is slow) so the server action never hits the function timeout;
 * the dashboard button keeps calling until a chunk reports 0 sent or
 * nothing remains. Oldest stage first. Skips clients with no email.
 */
export async function batchSendMissingInvoicesAction(): Promise<BatchSendResult> {
  const CHUNK = 6;
  const GAP_MS = 700; // Resend rate-limit friendliness
  try {
    await requireAdmin();
    const supabase = await createClient();
    const { data: rows, error } = await supabase
      .from("stages")
      .select("id, address, stage_date, clients(email)")
      .is("paid_at", null)
      .gt("amount", 0)
      .is("invoice_sent_at", null)
      .not("status", "in", "(cancelled,estimate,scheduled)")
      .order("stage_date", { ascending: true, nullsFirst: false });
    if (error) throw new Error(error.message);

    const eligible = (rows ?? []).filter((r: any) => {
      const c = Array.isArray(r.clients) ? r.clients[0] : r.clients;
      return !!c?.email;
    });

    const { sendInvoiceEmailFor } = await import("@/lib/invoice-email-core");
    let sent = 0;
    const failed: Array<{ address: string; error: string }> = [];
    for (const r of eligible.slice(0, CHUNK)) {
      const res = await sendInvoiceEmailFor(supabase, r.id);
      if (res.ok) {
        sent += 1;
      } else {
        failed.push({ address: r.address, error: res.error });
      }
      await new Promise((resolve) => setTimeout(resolve, GAP_MS));
    }

    revalidatePath("/");
    return {
      ok: true,
      sent,
      failed,
      remaining: eligible.length - sent,
    };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Batch send failed" };
  }
}

/**
 * Extensions twin of batchSendMissingInvoicesAction: emails the
 * extension invoice for every unpaid extension that never had one sent
 * (pdf_sent_at null). Same chunking; each send runs through
 * resendExtensionInvoiceAction (PDF generated if missing, pdf_sent_at
 * stamped, reminder clock armed). Oldest extension first.
 */
export async function batchSendMissingExtensionInvoicesAction(): Promise<BatchSendResult> {
  const CHUNK = 6;
  const GAP_MS = 700;
  try {
    await requireAdmin();
    const supabase = await createClient();
    const { data: rows, error } = await supabase
      .from("stage_extensions")
      .select(
        "id, extension_date, stage:stages(address, status, clients(email))",
      )
      .is("paid_at", null)
      .gt("amount", 0)
      .is("pdf_sent_at", null)
      .order("extension_date", { ascending: true, nullsFirst: false });
    if (error) throw new Error(error.message);

    const eligible = (rows ?? []).filter((r: any) => {
      const stage = Array.isArray(r.stage) ? r.stage[0] : r.stage;
      const c = Array.isArray(stage?.clients)
        ? stage.clients[0]
        : stage?.clients;
      return (
        stage &&
        stage.status !== "cancelled" &&
        stage.status !== "estimate" &&
        !!c?.email
      );
    });

    let sent = 0;
    const failed: Array<{ address: string; error: string }> = [];
    for (const r of eligible.slice(0, CHUNK)) {
      const stage = Array.isArray((r as any).stage)
        ? (r as any).stage[0]
        : (r as any).stage;
      const res = await resendExtensionInvoiceAction(r.id);
      if (res.ok) {
        sent += 1;
      } else {
        failed.push({
          address: stage?.address ?? "extension",
          error: res.error,
        });
      }
      await new Promise((resolve) => setTimeout(resolve, GAP_MS));
    }

    revalidatePath("/");
    return { ok: true, sent, failed, remaining: eligible.length - sent };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Batch send failed" };
  }
}

/**
 * Set (or clear) the contingency-removal date for a stage — the day
 * the buyer's contingencies lift on the sale. Admin-only; shown on the
 * stage page and in the dashboard's "Contingency removals" section.
 */
export async function updateContingencyDateAction(
  stageId: string,
  date: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin();
  let value: string | null = null;
  if (date != null && date !== "") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return { ok: false, error: "Invalid date." };
    }
    value = date;
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("stages")
    .update({ contingency_removal_date: value })
    .eq("id", stageId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/stages/${stageId}`);
  revalidatePath("/");
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
  field: "stage_date" | "destage_date" | "lockbox_code" | "notes" | "bill_to",
  value: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // bill_to (billing entity) is admin-only like the dates — it lands
  // on the invoice, so stagers can't touch it.
  const ALLOWED = ["stage_date", "destage_date", "lockbox_code", "notes", "bill_to"];
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
    if (isR2Path(photo.storage_path)) {
      try {
        await deleteR2Object(r2Key(photo.storage_path));
      } catch (e) {
        console.error("[r2] delete failed:", e);
      }
    } else {
      await supabase.storage.from("stage-photos").remove([photo.storage_path]);
    }
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

/**
 * Re-send (or first-send) an extension invoice email — the extensions
 * twin of sendInvoiceEmailAction. Generates the PDF first if the row
 * never got one, emails the client on file, and stamps pdf_sent_at —
 * which arms the same 5-day-then-every-3-days payment-reminder clock
 * stage invoices use.
 */
export async function resendExtensionInvoiceAction(
  extensionId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireAdmin();
    const supabase = await createClient();
    const { data: ext, error: extErr } = await supabase
      .from("stage_extensions")
      .select(
        "id, stage_id, amount, extension_date, pdf_url, stage:stages(id, address, city, amount, bill_to, line_items, stage_date, destage_date, clients(name, email))",
      )
      .eq("id", extensionId)
      .single();
    if (extErr) throw new Error(extErr.message);
    const stage = Array.isArray(ext.stage) ? ext.stage[0] : ext.stage;
    if (!stage) return { ok: false, error: "Stage not found." };
    const client = Array.isArray((stage as any).clients)
      ? (stage as any).clients[0]
      : (stage as any).clients;
    const clientEmail = (client?.email as string | undefined) || undefined;
    if (!clientEmail) {
      return { ok: false, error: "No client email on file." };
    }
    const throughDate: string | null =
      ext.extension_date ?? (stage as any).destage_date ?? null;
    if (!throughDate) {
      return { ok: false, error: "Extension has no date on file." };
    }

    // Make sure there's a PDF to send — generate one for rows that
    // never got theirs (e.g. a manual extension whose generation
    // failed at record time).
    let pdfUrl: string | null = ext.pdf_url ?? null;
    if (!pdfUrl) {
      const { generateExtensionInvoice } = await import(
        "@/lib/extension-core"
      );
      const { url } = await generateExtensionInvoice(
        stage,
        Number(ext.amount),
        throughDate,
      );
      pdfUrl = url;
      const { error: pdfErr } = await supabase
        .from("stage_extensions")
        .update({ pdf_url: pdfUrl })
        .eq("id", extensionId);
      if (pdfErr) throw new Error(pdfErr.message);
    }

    const { sendExtensionEmailToClient } = await import(
      "@/lib/extension-core"
    );
    const sent = await sendExtensionEmailToClient({
      clientName: client?.name ?? null,
      clientEmail,
      address: (stage as any).address,
      newDestage: throughDate,
      amount: Number(ext.amount ?? 0),
      invoiceUrl: pdfUrl,
    });
    if (!sent) {
      return { ok: false, error: "Email isn't configured on the server." };
    }

    // Arms (or re-arms) the payment-reminder clock, same as invoices.
    const { error: stampErr } = await supabase
      .from("stage_extensions")
      .update({ pdf_sent_at: new Date().toISOString() })
      .eq("id", extensionId);
    if (stampErr) throw new Error(stampErr.message);

    revalidatePath(`/stages/${ext.stage_id}`);
    revalidatePath("/");
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Send failed" };
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
        "id, address, city, amount, bill_to, stage_date, destage_date, extension_count, clients(name, email)",
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

// ---------------------------------------------------------------------
// Arrival-issue fees: crew reports → fee invoice → admin approves send.
// ---------------------------------------------------------------------

export type FeeActionResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Crew reports an arrival issue (any team member). Inserts the pending
 * stage_fees row FIRST (so the PDF path can carry the row's uuid —
 * unguessable, never collides, no orphan objects), then generates the
 * invoice PDF so the admin can review the exact document, logs
 * activity, and pushes admins. Nothing is emailed to the client until
 * an admin approves.
 */
export async function reportArrivalIssueAction(
  stageId: string,
  input: { reasons: string[]; note?: string | null },
): Promise<FeeActionResult> {
  // Guard OUTSIDE the try so a redirect() isn't swallowed as an error.
  await requireTeamMember();
  const { isArrivalFeeReason, arrivalFeeTotal, arrivalFeeLabels } =
    await import("@/lib/arrival-fees");
  const reasons = Array.from(new Set(input.reasons.filter(isArrivalFeeReason)));
  if (reasons.length === 0) {
    return { ok: false, error: "Pick at least one issue." };
  }
  const note = (input.note ?? "").trim().slice(0, 500) || null;

  const supabase = await createClient();
  let feeId: string | null = null;
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data: me } = await supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", user?.id ?? "")
      .maybeSingle();
    const reporterName = me?.full_name || me?.email || null;

    const { data: stage, error: stageErr } = await supabase
      .from("stages")
      .select("id, address, signature_completed_at, agreement_fee_initials")
      .eq("id", stageId)
      .single();
    if (stageErr || !stage) throw new Error(stageErr?.message || "Stage not found");
    // Only claim "initialed by client" when THIS stage's agreement
    // carried the Additional Fees block and was actually signed.
    const initialed =
      !!stage.signature_completed_at && !!(stage as any).agreement_fee_initials;

    const { data: inserted, error: insErr } = await supabase
      .from("stage_fees")
      .insert({
        stage_id: stageId,
        reasons,
        note,
        amount: arrivalFeeTotal(reasons),
        status: "pending",
        reported_by: user?.id ?? null,
        reported_by_name: reporterName,
      })
      .select("id")
      .single();
    if (insErr || !inserted) throw new Error(insErr?.message || "Insert failed");
    feeId = inserted.id as string;

    const { count } = await supabase
      .from("stage_fees")
      .select("id", { count: "exact", head: true })
      .eq("stage_id", stageId);

    const { generateFeeInvoice } = await import("@/lib/fee-invoice-core");
    const pdf = await generateFeeInvoice(supabase, {
      stageId,
      feeId,
      reasons,
      sequence: Math.max(1, count ?? 1),
      note,
      initialed,
    });
    const { error: upErr } = await supabase
      .from("stage_fees")
      .update({ invoice_number: pdf.invoiceNumber, pdf_url: pdf.url })
      .eq("id", feeId);
    if (upErr) throw new Error(upErr.message);

    const summary = arrivalFeeLabels(reasons).join(", ");
    await logActivity(supabase, {
      kind: "arrival_issue",
      stageId,
      stageAddress: stage.address,
      details: { reasons, note, amount: arrivalFeeTotal(reasons) },
    });
    try {
      const { notifyArrivalIssue } = await import("@/lib/notify");
      await notifyArrivalIssue({
        stageId,
        address: stage.address,
        summary,
        reportedBy: reporterName,
      });
    } catch (e) {
      console.error("[arrival-issue] admin push failed:", e);
    }

    revalidatePath(`/stages/${stageId}`);
    revalidatePath("/");
    return { ok: true };
  } catch (e: any) {
    // PDF or follow-up failed after the row went in — remove the
    // half-made row so the admin never sees a fee with no invoice.
    if (feeId) {
      await supabase.from("stage_fees").delete().eq("id", feeId);
    }
    return { ok: false, error: e?.message || "Couldn't report the issue" };
  }
}

/**
 * Admin approves a pending fee: CLAIMS the row (pending → sent) with a
 * conditional update first so two admins / a double-tap / a retry can
 * never email the client twice, then sends the invoice (BCC admins,
 * like every invoice). If the send fails, the claim is reverted.
 */
export async function approveFeeInvoiceAction(
  feeId: string,
): Promise<FeeActionResult> {
  await requireAdmin();
  if (!isEmailConfigured()) {
    return { ok: false, error: "Email isn't configured on the server." };
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const nowIso = new Date().toISOString();

  // Atomic claim — only one caller gets the row back.
  const { data: fee, error: claimErr } = await supabase
    .from("stage_fees")
    .update({
      status: "sent",
      approved_by: user?.id ?? null,
      approved_at: nowIso,
      sent_at: nowIso,
    })
    .eq("id", feeId)
    .eq("status", "pending")
    .select(
      "id, stage_id, reasons, note, amount, pdf_url, invoice_number, stage:stages(address, signature_completed_at, agreement_fee_initials, clients(name, email))",
    )
    .maybeSingle();
  if (claimErr) return { ok: false, error: claimErr.message };
  if (!fee) {
    return { ok: false, error: "This fee was already handled (refresh to see its status)." };
  }

  const revert = async () => {
    await supabase
      .from("stage_fees")
      .update({ status: "pending", approved_by: null, approved_at: null, sent_at: null })
      .eq("id", feeId)
      .eq("status", "sent");
  };

  try {
    if (!fee.pdf_url) {
      await revert();
      return { ok: false, error: "No invoice PDF on this fee." };
    }
    const stage = Array.isArray(fee.stage) ? fee.stage[0] : fee.stage;
    const client = Array.isArray((stage as any)?.clients)
      ? (stage as any).clients[0]
      : (stage as any)?.clients;
    const clientEmail = (client?.email as string | undefined) || "";
    if (!clientEmail) {
      await revert();
      return { ok: false, error: "Client has no email on file." };
    }

    const { arrivalFeeLabels } = await import("@/lib/arrival-fees");
    const labels = arrivalFeeLabels(fee.reasons as string[]);
    const amount = Number(fee.amount ?? 0);
    const address = (stage as any)?.address ?? "your staging";
    const greeting = String(client?.name ?? "").split(/\s+/)[0] || "there";
    const initialed =
      !!(stage as any)?.signature_completed_at &&
      !!(stage as any)?.agreement_fee_initials;
    const basis = initialed
      ? "Per the Additional Fees section of your staging agreement (initialed)"
      : "Per our staging terms";

    const { data: admins } = await supabase
      .from("profiles")
      .select("email")
      .eq("role", "admin");
    const bcc = (admins ?? [])
      .map((a: any) => a.email as string | null)
      .filter((e): e is string => !!e && e.toLowerCase() !== clientEmail.toLowerCase())
      .slice(0, 50);

    const subject = `Additional fee invoice for ${address} — Revive Design Collective`;
    const reasonLines = labels.map((l) => `- ${l}`).join("\n");
    const text =
      `Hi ${greeting},\n\n` +
      `${basis}, a fee applies for ${address}:\n\n${reasonLines}\n\n` +
      `Total: $${amount.toFixed(2)}\n\nInvoice PDF: ${fee.pdf_url}\n\n` +
      `Payable by check, cash, or Zelle — details on the invoice. Reach out with any questions.\n\nRevive Design Collective`;
    const html = `
      <div style="font-family: -apple-system, system-ui, sans-serif; color: #0f172a; max-width: 560px; margin: 0 auto;">
        <p>Hi ${escapeHtml(greeting)},</p>
        <p>${escapeHtml(basis)}, a fee applies for <strong>${escapeHtml(address)}</strong>:</p>
        <ul>${labels.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>
        <p><strong>Total: $${escapeHtml(amount.toFixed(2))}</strong></p>
        <p><a href="${escapeHtml(fee.pdf_url)}" style="display:inline-block; padding:10px 18px; background:#7c8b76; border-radius:8px; color:#ffffff; font-weight:600; text-decoration:none;">View invoice PDF</a></p>
        <p style="color:#475569; font-size:14px;">Payable by check, cash, or Zelle — details on the invoice. Reach out with any questions.</p>
        <p style="color:#475569; font-size:14px;">— Revive Design Collective</p>
      </div>`;

    await sendEmail({
      to: clientEmail,
      ...(bcc.length > 0 ? { bcc } : {}),
      subject,
      text,
      html,
    });

    revalidatePath(`/stages/${fee.stage_id}`);
    revalidatePath("/");
    return { ok: true };
  } catch (e: any) {
    await revert();
    return { ok: false, error: e?.message || "Approve failed" };
  }
}

/** Admin dismisses a reported fee (no invoice goes out). */
export async function dismissFeeAction(feeId: string): Promise<FeeActionResult> {
  await requireAdmin();
  try {
    const supabase = await createClient();
    const { data: fee, error } = await supabase
      .from("stage_fees")
      .update({ status: "dismissed" })
      .eq("id", feeId)
      .eq("status", "pending")
      .select("stage_id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!fee) {
      return { ok: false, error: "This fee was already handled (refresh to see its status)." };
    }
    revalidatePath(`/stages/${fee.stage_id}`);
    revalidatePath("/");
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Dismiss failed" };
  }
}

/** Admin marks a sent fee invoice paid (sent → paid) or unpaid (paid → sent). */
export async function setFeePaidAction(
  feeId: string,
  paid: boolean,
): Promise<FeeActionResult> {
  await requireAdmin();
  try {
    const supabase = await createClient();
    const { data: fee, error } = await supabase
      .from("stage_fees")
      .update({
        status: paid ? "paid" : "sent",
        paid_at: paid ? new Date().toISOString() : null,
      })
      .eq("id", feeId)
      .eq("status", paid ? "sent" : "paid")
      .select("stage_id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!fee) {
      return { ok: false, error: "Nothing to update (refresh to see the current status)." };
    }
    revalidatePath(`/stages/${fee.stage_id}`);
    revalidatePath("/");
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Update failed" };
  }
}

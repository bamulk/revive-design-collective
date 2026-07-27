"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireEstimateAccess } from "@/lib/permissions";
import { sendEmail, isEmailConfigured } from "@/lib/email-send";
import { emailButton } from "@/lib/email-button";
import {
  PACKAGES,
  ADD_ONS,
  ESCROW_FEE,
  normalizeTravelFee,
  computePrice,
  parseLineItems,
  sumLineItems,
  type SelectedAddOn,
} from "@/lib/pricing";

/** Generates a 32-char URL-safe token for the public accept link. */
function newToken(): string {
  return randomBytes(24).toString("base64url");
}

// Same pricing parser as stages/actions.ts, copied to avoid a circular
// import (server actions can only export async functions).
function parsePricingFromForm(formData: FormData) {
  const escrow =
    formData.get("escrow") === "on" || formData.get("escrow") === "true";
  const escrowFee = escrow ? ESCROW_FEE : 0;
  const travelFee = normalizeTravelFee(formData.get("travel_fee"));
  // Custom line items add their prices to the total in either pricing
  // mode and ride along on the estimate / contract / invoice.
  const lineItems = parseLineItems(formData.get("line_items"));
  const lineItemsTotal = sumLineItems(lineItems);

  // Custom price mode short-circuits the catalog.
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
  let addOns: SelectedAddOn[] = [];
  try {
    const raw = (formData.get("add_ons") as string) || "[]";
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      addOns = parsed.filter(
        (a) =>
          a && typeof a.key === "string" && typeof a.qty === "number" && a.qty > 0
      );
    }
  } catch {
    addOns = [];
  }
  const discount = Math.max(0, Number(formData.get("discount") || 0)) || 0;
  // Validate keys exist in the catalog.
  const validPackage = PACKAGES.find((p) => p.key === packageKey)?.key ?? null;
  const validAddOnSet = new Set(ADD_ONS.map((a) => a.key));
  const validAddOns = addOns.filter((a) => validAddOnSet.has(a.key));
  const breakdown = computePrice(validPackage, validAddOns, discount);
  return {
    packageKey: validPackage,
    addOns: validAddOns,
    discount,
    escrow,
    travelFee,
    lineItems,
    amount: breakdown.total + escrowFee + travelFee + lineItemsTotal,
  };
}

export async function createEstimateAction(formData: FormData) {
  const supabase = await createClient();

  // Inline-client support: same shape as createStageAction.
  let clientId = (formData.get("client_id") as string) || null;
  const newClientName = ((formData.get("new_client_name") as string) || "").trim();
  if (!clientId && newClientName) {
    const newClient: Record<string, unknown> = { name: newClientName };
    const email = ((formData.get("new_client_email") as string) || "").trim();
    const phone = ((formData.get("new_client_phone") as string) || "").trim();
    if (email) newClient.email = email;
    if (phone) newClient.phone = phone;
    const { data: created, error: cErr } = await supabase
      .from("clients")
      .insert(newClient)
      .select("id")
      .single();
    if (cErr) throw new Error(`Could not create client: ${cErr.message}`);
    clientId = created.id;
    revalidatePath("/clients");
  }

  if (!clientId) throw new Error("Client is required");
  const address = String(formData.get("address") || "").trim();
  if (!address) throw new Error("Address is required");

  const pricing = parsePricingFromForm(formData);
  if (!pricing.packageKey && !(pricing.amount > 0)) {
    throw new Error("Pick a package or enter a custom price");
  }

  // Inline helpers — kept local since this file is small.
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

  // 60- or 90-day stage length from the "Extended 90-day stage"
  // checkbox. Defaults to 60. Used to auto-derive destage_date below
  // and rendered on the contract + invoice PDFs.
  const stageLengthDays: 60 | 90 =
    formData.get("extended_stage") === "on" ||
    formData.get("extended_stage") === "true" ||
    String(formData.get("stage_length_days") ?? "") === "90"
      ? 90
      : 60;

  // Auto-derive destage_date from stage_date + stage length when the
  // user didn't type one. Same math as defaultDestage() in
  // stages/actions.ts; kept inline to avoid pulling that whole module
  // (and its package-pricing parser) into the estimates path.
  const stageDateIn = (formData.get("stage_date") as string) || null;
  let destageDateIn = (formData.get("destage_date") as string) || null;
  if (!destageDateIn && stageDateIn && /^\d{4}-\d{2}-\d{2}$/.test(stageDateIn)) {
    const [y, m, d] = stageDateIn.split("-").map(Number);
    const t = Date.UTC(y, m - 1, d) + stageLengthDays * 86400000;
    const dt = new Date(t);
    destageDateIn = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
  }

  const payload = {
    client_id: clientId,
    address,
    city: (formData.get("city") as string)?.trim() || null,
    square_footage: parseIntOrNull(formData.get("square_footage")),
    bedrooms: parseIntOrNull(formData.get("bedrooms")),
    bathrooms: parseFloatOrNull(formData.get("bathrooms")),
    zillow_url: ((formData.get("zillow_url") as string) || "").trim() || null,
    primary_only:
      formData.get("primary_only") === "on" ||
      formData.get("primary_only") === "true",
    amount: pricing.amount,
    package_key: pricing.packageKey,
    add_ons: pricing.addOns,
    discount: pricing.discount,
    escrow: pricing.escrow,
    travel_fee: pricing.travelFee,
    line_items: pricing.lineItems,
    stage_date: stageDateIn,
    destage_date: destageDateIn,
    stage_length_days: stageLengthDays,
    notes: (formData.get("notes") as string) || null,
    status: "estimate" as const,
    secondary_recipient_name:
      ((formData.get("secondary_recipient_name") as string) || "").trim() ||
      null,
    secondary_recipient_email:
      ((formData.get("secondary_recipient_email") as string) || "")
        .trim()
        .toLowerCase() || null,
    estimate_token: newToken(),
  };

  const { data, error } = await supabase
    .from("stages")
    .insert(payload)
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  // Auto-send the branded estimate email BEFORE redirecting, so the
  // detail page lands showing the true "Sent" state. This used to run
  // post-response via after(), which caused a double-send: the page
  // rendered "Not sent" for the seconds the background send took,
  // inviting a manual send on top of the automatic one (happened on
  // 4924 Village Green — two emails 5s apart). Costs ~1s on creation.
  // Failures are non-fatal: the page then shows "Not sent" honestly
  // and the admin sends manually.
  const newStageId = data.id;
  try {
    const admin = createAdminClient();
    const res = await sendEstimateEmailFor(admin, newStageId);
    if (!res.ok) {
      console.warn("[createEstimateAction auto-send]", newStageId, res.error);
    }
  } catch (e) {
    console.error("[createEstimateAction auto-send]", newStageId, e);
  }

  revalidatePath("/estimates");
  redirect(`/estimates/${data.id}`);
}

/**
 * Update an existing pending estimate. Mirrors the create action but
 * patches the row instead of inserting + auto-sending. The admin can
 * resend the (new) estimate manually from the share-link card.
 *
 * Only acts on rows still in `status = 'estimate'` so an accepted /
 * declined estimate can't be silently mutated.
 */
export async function updateEstimateAction(stageId: string, formData: FormData) {
  await requireEstimateAccess();
  const supabase = await createClient();

  // Same client-handling shape as createEstimateAction: explicit id or
  // inline new-client.
  let clientId = (formData.get("client_id") as string) || null;
  const newClientName = ((formData.get("new_client_name") as string) || "").trim();
  if (!clientId && newClientName) {
    const newClient: Record<string, unknown> = { name: newClientName };
    const email = ((formData.get("new_client_email") as string) || "").trim();
    const phone = ((formData.get("new_client_phone") as string) || "").trim();
    if (email) newClient.email = email;
    if (phone) newClient.phone = phone;
    const { data: created, error: cErr } = await supabase
      .from("clients")
      .insert(newClient)
      .select("id")
      .single();
    if (cErr) throw new Error(`Could not create client: ${cErr.message}`);
    clientId = created.id;
    revalidatePath("/clients");
  }
  if (!clientId) throw new Error("Client is required");

  const address = String(formData.get("address") || "").trim();
  if (!address) throw new Error("Address is required");

  const pricing = parsePricingFromForm(formData);
  if (!pricing.packageKey && !(pricing.amount > 0)) {
    throw new Error("Pick a package or enter a custom price");
  }

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

  const stageLengthDays: 60 | 90 =
    formData.get("extended_stage") === "on" ||
    formData.get("extended_stage") === "true" ||
    String(formData.get("stage_length_days") ?? "") === "90"
      ? 90
      : 60;

  const stageDateIn = (formData.get("stage_date") as string) || null;
  let destageDateIn = (formData.get("destage_date") as string) || null;
  if (!destageDateIn && stageDateIn && /^\d{4}-\d{2}-\d{2}$/.test(stageDateIn)) {
    const [y, m, d] = stageDateIn.split("-").map(Number);
    const t = Date.UTC(y, m - 1, d) + stageLengthDays * 86400000;
    const dt = new Date(t);
    destageDateIn = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
  }

  const patch = {
    client_id: clientId,
    address,
    city: (formData.get("city") as string)?.trim() || null,
    square_footage: parseIntOrNull(formData.get("square_footage")),
    bedrooms: parseIntOrNull(formData.get("bedrooms")),
    bathrooms: parseFloatOrNull(formData.get("bathrooms")),
    zillow_url: ((formData.get("zillow_url") as string) || "").trim() || null,
    primary_only:
      formData.get("primary_only") === "on" ||
      formData.get("primary_only") === "true",
    amount: pricing.amount,
    package_key: pricing.packageKey,
    add_ons: pricing.addOns,
    discount: pricing.discount,
    escrow: pricing.escrow,
    travel_fee: pricing.travelFee,
    line_items: pricing.lineItems,
    stage_date: stageDateIn,
    destage_date: destageDateIn,
    stage_length_days: stageLengthDays,
    notes: (formData.get("notes") as string) || null,
    secondary_recipient_name:
      ((formData.get("secondary_recipient_name") as string) || "").trim() ||
      null,
    secondary_recipient_email:
      ((formData.get("secondary_recipient_email") as string) || "")
        .trim()
        .toLowerCase() || null,
  };

  const { error } = await supabase
    .from("stages")
    .update(patch)
    .eq("id", stageId)
    .eq("status", "estimate");
  if (error) throw new Error(error.message);

  revalidatePath("/estimates");
  revalidatePath(`/estimates/${stageId}`);
  redirect(`/estimates/${stageId}`);
}

export type DeleteEstimateResult = { ok: true } | { ok: false; error: string };

export async function deleteEstimateAction(
  stageId: string
): Promise<DeleteEstimateResult> {
  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("stages")
      .delete()
      .eq("id", stageId)
      .eq("status", "estimate"); // safety: only delete if still an estimate
    if (error) throw new Error(error.message);
    revalidatePath("/estimates");
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Delete failed" };
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export type SendEstimateEmailResult =
  | { ok: true; messageId: string }
  | { ok: false; error: string };

/**
 * Shared estimate-send pipeline. Loads the stage + client, builds a
 * branded Resend email with the accept link, BCC's admins, and stamps
 * `estimate_sent_at` on success.
 *
 * Pass any Supabase client (user-bound or admin); auth is the caller's
 * responsibility. `sendEstimateEmailAction` wraps this with an admin
 * check; `createEstimateAction` awaits it inline before redirecting so
 * the detail page lands showing the true sent state.
 */
async function sendEstimateEmailFor(
  supabase: SupabaseClient,
  stageId: string,
): Promise<SendEstimateEmailResult> {
  try {
    if (!isEmailConfigured()) {
      return {
        ok: false,
        error: "Email isn't configured — set RESEND_API_KEY and EMAIL_FROM.",
      };
    }

    const { data: stage } = await supabase
      .from("stages")
      .select(
        "id, address, amount, estimate_token, status, secondary_recipient_email, clients(name, email)",
      )
      .eq("id", stageId)
      .single();
    if (!stage) return { ok: false, error: "Estimate not found." };
    if (stage.status !== "estimate") {
      return {
        ok: false,
        error: "This stage isn't in estimate status.",
      };
    }
    if (!stage.estimate_token) {
      return {
        ok: false,
        error: "No estimate link on file — regenerate the link and try again.",
      };
    }
    const client = Array.isArray(stage.clients) ? stage.clients[0] : stage.clients;
    const c = client as { name: string; email: string | null } | null;
    if (!c?.email) {
      return {
        ok: false,
        error: "Client has no email on file — add one to the client's page first.",
      };
    }

    const siteUrl = (
      process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
      "https://app.revivedesigncollective.com"
    );
    const acceptUrl = `${siteUrl}/e/${stage.estimate_token}`;

    // BCC every admin for record-keeping. Same pattern as invoice emails.
    const { data: admins } = await supabase
      .from("profiles")
      .select("email")
      .eq("role", "admin");
    const bcc = (admins ?? [])
      .map((a: any) => a.email)
      .filter((e: string | null) => !!e && e !== c.email)
      .slice(0, 50);

    const total = Number(stage.amount ?? 0).toFixed(2);
    const greeting = c.name.split(/\s+/)[0] || c.name;
    const subject = `Your Revive Design Collective estimate — ${stage.address}`;
    const text =
      `Hi ${greeting},\n\nHere's your staging estimate for ${stage.address}. ` +
      `Please review and accept or decline:\n\n${acceptUrl}\n\n` +
      `Estimated total: $${total}` +
      "\n\nOnce accepted, we'll send an invoice. Payment by check / cash / Zelle / Venmo." +
      `\n\nReach out if you have any questions.\n\nRevive Design Collective`;

    const html = `
      <div style="font-family: -apple-system, system-ui, sans-serif; color: #0f172a; max-width: 560px; margin: 0 auto;">
        <p>Hi ${escapeHtml(greeting)},</p>
        <p>
          Here's your staging estimate for
          <strong>${escapeHtml(stage.address)}</strong>. Please review and
          accept or decline.
        </p>
        ${emailButton({ href: acceptUrl, label: "Review estimate" })}
        <p><strong>Estimated total: $${escapeHtml(total)}</strong></p>
        <p style="color:#475569; font-size: 14px;">
          Once accepted, we'll send an invoice. Payment by check / cash / Zelle / Venmo.
        </p>
        <p style="color:#475569; font-size: 14px;">
          Reach out if you have any questions.
        </p>
        <p style="color:#475569; font-size: 14px;">— Revive Design Collective</p>
      </div>
    `;

    // CC the secondary recipient when set so the homeowner / co-payer
    // sees the estimate alongside the primary client.
    const secondaryEmail =
      typeof (stage as any).secondary_recipient_email === "string"
        ? (stage as any).secondary_recipient_email.trim().toLowerCase()
        : "";
    const cc =
      secondaryEmail && secondaryEmail !== c.email.toLowerCase()
        ? [secondaryEmail]
        : [];

    const { id: messageId } = await sendEmail({
      to: c.email,
      ...(cc.length > 0 ? { cc } : {}),
      ...(bcc.length > 0 ? { bcc } : {}),
      subject,
      text,
      html,
    });

    await supabase
      .from("stages")
      .update({ estimate_sent_at: new Date().toISOString() })
      .eq("id", stageId);

    revalidatePath(`/estimates/${stageId}`);
    revalidatePath("/estimates");
    return { ok: true, messageId };
  } catch (e: any) {
    console.error("[sendEstimateEmailFor]", e);
    return { ok: false, error: e?.message || "Send failed" };
  }
}

/** Admin-callable wrapper around the shared send pipeline. */
export async function sendEstimateEmailAction(
  stageId: string,
): Promise<SendEstimateEmailResult> {
  await requireEstimateAccess();
  const supabase = await createClient();
  return sendEstimateEmailFor(supabase, stageId);
}

export async function regenerateEstimateTokenAction(
  stageId: string
): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  try {
    const supabase = await createClient();
    const token = newToken();
    const { error } = await supabase
      .from("stages")
      .update({ estimate_token: token, estimate_sent_at: null })
      .eq("id", stageId)
      .eq("status", "estimate");
    if (error) throw new Error(error.message);
    revalidatePath(`/estimates/${stageId}`);
    return { ok: true, token };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Regenerate failed" };
  }
}

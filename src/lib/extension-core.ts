/**
 * Server-side logic for the staging-extension flow.
 *
 *   extendStage()       — Client confirms an extension. Bumps the
 *                         destage_date 30 days, generates a 50% invoice
 *                         PDF, stores it, and notifies admins.
 *   recordDestageChoice — Client confirms the existing destage_date
 *                         is fine. Just notifies admins.
 *
 * Both are callable from the public /x/[token] page using the
 * service-role admin client so they work without a signed-in user.
 */
import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateInvoicePdf, invoiceNumberFor } from "@/lib/invoice-pdf";
import { sendEmail, isEmailConfigured } from "@/lib/email-send";
import { emailButton } from "@/lib/email-button";
import { sendPushToUsers, isPushConfigured } from "@/lib/push";
import { todayPacificISO, addDaysISO, formatMDY } from "@/lib/time";
import { parseLineItems, sumLineItems } from "@/lib/pricing";

const APP_NAME = "Revive Design Collective";

export function newExtensionToken(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * Fetch the stage by extension token; finds it whether the token is
 * still active (extension_token) OR already consumed
 * (extension_token_consumed) so the /x page can render its
 * "Thanks for your response" state instead of 404'ing after the
 * client clicks Extend / Destage.
 */
export async function loadStageByToken(token: string) {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("stages")
    .select(
      `
        id, address, city, status, stage_date, destage_date, amount,
        package_key, add_ons, discount, line_items,
        extension_token, extension_token_consumed, extension_count,
        extension_invoice_pdf_url, extension_invoice_amount,
        extension_invoice_paid_at, clients(name, email)
      `,
    )
    .or(
      `extension_token.eq.${token},extension_token_consumed.eq.${token}`,
    )
    .maybeSingle();
  return data;
}

/** Helper — admin emails from the profiles table. */
async function adminContacts() {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, sms_notifications_enabled, role")
    .eq("role", "admin")
    .eq("sms_notifications_enabled", true);
  return { userIds: (data ?? []).map((r: any) => r.id) };
}

async function notifyAdmins(message: string, stageId: string) {
  if (!isPushConfigured()) return;
  const { userIds } = await adminContacts();
  if (userIds.length === 0) return;
  await sendPushToUsers(userIds, {
    title: APP_NAME,
    body: message,
    url: `/stages/${stageId}`,
    tag: `extension-${stageId}`,
  });
}

/**
 * Email the extension confirmation + invoice link to the client.
 * Shared by the /x auto flow and the manual-record action. Returns
 * true if the email was actually sent (so callers can stamp
 * pdf_sent_at on the corresponding stage_extensions row).
 */
export async function sendExtensionEmailToClient(opts: {
  clientName: string | null;
  clientEmail: string | null;
  address: string;
  newDestage: string;
  amount: number;
  invoiceUrl: string;
}): Promise<boolean> {
  if (!isEmailConfigured() || !opts.clientEmail) return false;
  const firstName = (opts.clientName || "there").split(" ")[0] || "there";
  const subject = `Extension confirmed — ${opts.address}`;
  const text = `Hi ${firstName},

Your staging at ${opts.address} has been extended through ${formatMDY(
    opts.newDestage,
  )}.

Extension fee: $${opts.amount.toFixed(2)}
Invoice: ${opts.invoiceUrl}

Thanks for choosing Revive Design Collective!`;
  const html = `<!DOCTYPE html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; line-height:1.5; color:#0f172a; max-width:560px; margin:0 auto; padding:24px;">
  <p>Hi ${firstName},</p>
  <p>Your staging at <strong>${opts.address}</strong> has been extended through <strong>${formatMDY(opts.newDestage)}</strong>.</p>
  <p style="background:#fff8f8; border:1px solid #fce4e4; border-radius:8px; padding:14px;">
    Extension fee: <strong>$${opts.amount.toFixed(2)}</strong>
  </p>
  ${emailButton({ href: opts.invoiceUrl, label: "View invoice" })}
  <p style="font-size:13px; color:#64748b;">Thanks for choosing Revive Design Collective!</p>
</body></html>`;
  // Always copy the shop inbox on extension confirmations.
  const COMPANY_CC = (process.env.COMPANY_CC_EMAIL || "").trim().toLowerCase();
  const cc =
    !COMPANY_CC || opts.clientEmail.toLowerCase() === COMPANY_CC
      ? undefined
      : COMPANY_CC;
  try {
    await sendEmail({
      to: opts.clientEmail,
      cc,
      subject,
      text,
      html,
    });
    return true;
  } catch (e) {
    console.error("[extension] client email failed:", e);
    return false;
  }
}

/**
 * Build an extension invoice PDF, upload to Storage, return the
 * public URL + the amount used. Defaults to 50% of the original
 * stage amount when no override is supplied — that's the standard
 * extension fee for the /x auto flow. The manual-record flow passes
 * its own amount.
 */
export async function generateExtensionInvoice(
  stage: any,
  overrideAmount?: number,
  /**
   * The new destage date the extension runs through. Callers that also
   * WRITE the stage's destage_date (the /x auto flow) must pass the
   * same value here so the invoice and the stage can never disagree —
   * they diverged once when this was computed in two places.
   */
  newDestageIso?: string,
): Promise<{
  url: string;
  amount: number;
}> {
  // The standard extension fee is 50% of the original staging charge.
  // One-time custom line items (e.g. "Piano move") are folded into
  // stage.amount, so back them out — they shouldn't recur on the
  // every-30-days extension. (Escrow/travel remain in the base, matching
  // pre-existing behavior.)
  const baseAmount =
    Number(stage.amount ?? 0) - sumLineItems(parseLineItems(stage.line_items));
  const extensionAmount =
    overrideAmount != null
      ? Math.round(overrideAmount * 100) / 100
      : Math.round(Math.max(0, baseAmount) * 50) / 100;

  const today = todayPacificISO();
  const newDestage = addDaysISO(stage.destage_date ?? today, 30);
  const invoiceNumber = `${invoiceNumberFor(stage.id, today)}-X${
    (stage.extension_count ?? 0) + 1
  }`;

  const pdfBytes = await generateInvoicePdf({
    companyName: APP_NAME,
    invoiceNumber,
    invoiceDate: today,
    dueDate: null,
    clientName: stage.clients?.name ?? "Client",
    clientEmail: stage.clients?.email ?? null,
    propertyAddress: stage.city
      ? `${stage.address}, ${stage.city}`
      : stage.address,
    stageDate: stage.stage_date ?? null,
    destageDate: newDestage,
    lineItems: [
      {
        label: `30-day staging extension (through ${formatMDY(newDestage)})`,
        amount: extensionAmount,
      },
    ],
    discount: 0,
    total: extensionAmount,
    paymentInstructions:
      "Payable by check, cash, or Zelle to Revive Design Collective.",
    terms: [
      `Extension confirmed online by ${
        stage.clients?.name ?? "the client"
      } on ${formatMDY(today)}.`,
    ],
  });

  // Upload to the contracts bucket (already public for direct URL access).
  const path = `extensions/${stage.id}/${invoiceNumber}.pdf`;
  const supabase = createAdminClient();
  const { error: upErr } = await supabase.storage
    .from("contracts")
    .upload(path, pdfBytes, {
      contentType: "application/pdf",
      upsert: true,
    });
  if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
  const { data: pub } = supabase.storage.from("contracts").getPublicUrl(path);
  return { url: pub.publicUrl, amount: extensionAmount };
}

/**
 * Client clicked "Extend 30 more days".
 * - destage_date += 30 days
 * - extension_count++
 * - Generate + email the 50% invoice
 * - Notify admins
 */
export async function extendStage(
  token: string,
  accept?: { ip?: string | null; userAgent?: string | null },
): Promise<
  | { ok: true; newDestageDate: string; amount: number }
  | { ok: false; error: string }
> {
  try {
    const stage = (await loadStageByToken(token)) as any;
    if (!stage) return { ok: false, error: "Invitation not found" };
    // Reject if the token's already been consumed — prevents the
    // client from re-extending by re-clicking the link.
    if (stage.extension_token !== token) {
      return {
        ok: false,
        error: "This extension link has already been used.",
      };
    }
    if (stage.status !== "staged") {
      return {
        ok: false,
        error: "This stage isn't currently active.",
      };
    }

    const supabase = createAdminClient();
    // A 30-day extension — computed ONCE and passed into the invoice
    // generator so the PDF and the stage row always agree. (This was
    // previously computed in two places, and this copy said 60 — the
    // stage jumped two months while the client's invoice said one.)
    const newDestage = addDaysISO(
      stage.destage_date ?? todayPacificISO(),
      30,
    );
    const { url, amount } = await generateExtensionInvoice(
      stage,
      undefined,
      newDestage,
    );

    // Insert a per-extension history row (source of truth for the
    // display). Capture the id so we can stamp pdf_sent_at after
    // the confirmation email goes out.
    // Lightweight acceptance record — the client's one-tap confirm is
    // the agreement; stamp who, when, and a basic audit trail.
    const acceptedBy = [stage.clients?.name, stage.clients?.email]
      .filter(Boolean)
      .join(" · ") || null;
    const { data: extRow, error: extErr } = await supabase
      .from("stage_extensions")
      .insert({
        stage_id: stage.id,
        extension_date: newDestage,
        amount,
        pdf_url: url,
        paid_at: null,
        source: "auto",
        accepted_at: new Date().toISOString(),
        accepted_by: acceptedBy,
        accepted_ip: accept?.ip ?? null,
        accepted_user_agent: accept?.userAgent ?? null,
      })
      .select("id")
      .single();
    if (extErr) throw new Error(extErr.message);
    const extensionRowId: string | null = extRow?.id ?? null;

    const { error } = await supabase
      .from("stages")
      .update({
        destage_date: newDestage,
        extension_count: (stage.extension_count ?? 0) + 1,
        extension_invoice_pdf_url: url,
        extension_invoice_amount: amount,
        extension_invoice_paid_at: null,
        // Burn the active token, stash it on extension_token_consumed
        // so /x/{token} can still render the "Thanks" state.
        extension_token: null,
        extension_token_consumed: token,
      })
      .eq("id", stage.id);
    if (error) throw new Error(error.message);

    // Email client a confirmation + invoice link.
    const sent = await sendExtensionEmailToClient({
      clientName: stage.clients?.name ?? null,
      clientEmail: stage.clients?.email ?? null,
      address: stage.address,
      newDestage,
      amount,
      invoiceUrl: url,
    });
    if (sent && extensionRowId) {
      await supabase
        .from("stage_extensions")
        .update({ pdf_sent_at: new Date().toISOString() })
        .eq("id", extensionRowId);
    }

    await notifyAdmins(
      `${stage.address}: extended 30 days (through ${formatMDY(newDestage)}). $${amount.toFixed(2)} invoice generated.`,
      stage.id,
    );

    return { ok: true, newDestageDate: newDestage, amount };
  } catch (err: any) {
    console.error("[extension] extendStage error:", err);
    return { ok: false, error: err?.message || "Extension failed" };
  }
}

/**
 * Client clicked "Schedule destage" — they're sticking with the
 * existing destage_date. No DB change beyond burning the token;
 * we just ping the admin team to make sure it gets on the calendar.
 */
export async function recordDestageChoice(
  token: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const stage = (await loadStageByToken(token)) as any;
    if (!stage) return { ok: false, error: "Invitation not found" };
    if (stage.extension_token !== token) {
      // Already decided — treat as a no-op success so the page just
      // shows the "Thanks" state instead of an error.
      return { ok: true };
    }

    const supabase = createAdminClient();
    await supabase
      .from("stages")
      .update({
        extension_token: null,
        extension_token_consumed: token,
      })
      .eq("id", stage.id);

    await notifyAdmins(
      `${stage.address}: client confirmed destage on ${formatMDY(stage.destage_date)}.`,
      stage.id,
    );
    return { ok: true };
  } catch (err: any) {
    console.error("[extension] recordDestageChoice error:", err);
    return { ok: false, error: err?.message || "Update failed" };
  }
}

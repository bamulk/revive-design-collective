/**
 * Reusable invoice email pipeline.
 *
 * Originally lived inside sendInvoiceEmailAction (admin-only, required
 * a signed-in user). Pulled out here so the signature-completed
 * webhook can also auto-send the invoice — and so the same code path
 * BCC's admins on every send for record-keeping.
 *
 *   sendInvoiceEmailFor(supabase, stageId)
 *     - Loads the stage + client
 *     - Generates the PDF if one isn't on file yet
 *     - Sends the email via Resend, BCC'd to all active admins
 *     - Stamps invoice_sent_at
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateInvoiceFor } from "@/lib/invoice-generate-core";
import { sendEmail, isEmailConfigured } from "@/lib/email-send";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export type InvoiceEmailResult =
  | { ok: true; messageId: string; pdfUrl: string }
  | { ok: false; error: string };

export async function sendInvoiceEmailFor(
  supabase: SupabaseClient,
  stageId: string,
): Promise<InvoiceEmailResult> {
  try {
    if (!isEmailConfigured()) {
      return {
        ok: false,
        error:
          "Email isn't configured — set RESEND_API_KEY and EMAIL_FROM.",
      };
    }

    const { data: stage } = await supabase
      .from("stages")
      .select(
        "id, address, amount, invoice_pdf_url, secondary_recipient_email, client:clients(name, email)",
      )
      .eq("id", stageId)
      .single();
    if (!stage) throw new Error("Stage not found");

    const client = Array.isArray(stage.client) ? stage.client[0] : stage.client;
    const c = client as { name: string; email: string | null } | null;
    if (!c?.email) {
      return {
        ok: false,
        error:
          "Client has no email on file — add one to the client's page first.",
      };
    }

    // Make sure a PDF exists.
    let pdfUrl = stage.invoice_pdf_url as string | null;
    if (!pdfUrl) {
      const { url } = await generateInvoiceFor(supabase, stageId);
      pdfUrl = url;
    }

    // BCC every admin so they get a copy. Resend's bcc field accepts
    // an array. We use BCC (not CC) so the client doesn't see other
    // admin email addresses.
    const { data: admins } = await supabase
      .from("profiles")
      .select("email")
      .eq("role", "admin");
    const bcc = (admins ?? [])
      .map((a: any) => a.email)
      .filter((e: string | null) => !!e && e !== c.email)
      .slice(0, 50); // Resend limit guardrail

    const total = Number(stage.amount).toFixed(2);
    const subject = `Invoice for ${stage.address} — Revive Design Collective`;
    const greeting = c.name.split(/\s+/)[0] || c.name;
    const text =
      `Hi ${greeting},\n\nThanks for choosing Revive Design Collective. ` +
      `Your invoice for ${stage.address} is attached as a PDF:\n\n${pdfUrl}\n\n` +
      `Total: $${total}` +
      "\n\nPayment by check / cash / Zelle / Venmo — details on the invoice." +
      `\n\nReach out if you have any questions.\n\nRevive Design Collective`;

    const html = `
      <div style="font-family: -apple-system, system-ui, sans-serif; color: #0f172a; max-width: 560px; margin: 0 auto;">
        <p>Hi ${escapeHtml(greeting)},</p>
        <p>
          Thanks for choosing Revive Design Collective. Your invoice for
          <strong>${escapeHtml(stage.address)}</strong> is ready.
        </p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 20px 0;">
          <tr>
            <td bgcolor="#7c8b76" style="border-radius:8px;">
              <a href="${pdfUrl}" style="display:inline-block; padding:12px 22px; color:#ffffff; font-weight:600; text-decoration:none; font-family:-apple-system,system-ui,sans-serif;">View invoice PDF</a>
            </td>
          </tr>
        </table>
        <p>
          <strong>Total: $${escapeHtml(total)}</strong>
        </p>
        <p style="color:#475569; font-size: 14px;">
          Payment by check / cash / Zelle / Venmo — details on the invoice.
        </p>
        <p style="color:#475569; font-size: 14px;">
          Reach out if you have any questions.
        </p>
        <p style="color:#475569; font-size: 14px;">— Revive Design Collective</p>
      </div>
    `;

    // CC the secondary recipient when set so the homeowner / co-payer
    // receives the invoice alongside the primary client. Resend ignores
    // an empty cc array, so only include it when there's an address.
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
      // Resend's API treats the absence of bcc as "no bcc" — passing
      // an empty array can error out, so we conditionally include it.
      ...(bcc.length > 0 ? { bcc } : {}),
      subject,
      text,
      html,
    });

    await supabase
      .from("stages")
      .update({ invoice_sent_at: new Date().toISOString() })
      .eq("id", stageId);

    return { ok: true, messageId, pdfUrl: pdfUrl! };
  } catch (e: any) {
    console.error("[invoice-email] failed:", e);
    return { ok: false, error: e?.message || "Send failed" };
  }
}

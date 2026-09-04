/**
 * PDF + email pipeline for standalone invoices (public.invoices).
 * Mirrors invoice-generate-core / invoice-email-core: takes an explicit
 * Supabase client so it can run from a server action today and a
 * webhook or cron later.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateInvoicePdf } from "@/lib/invoice-pdf";
import { getContractTemplate } from "@/lib/contract-template";
import { sendEmail, isEmailConfigured } from "@/lib/email-send";
import { emailButton } from "@/lib/email-button";
import {
  PAYMENT_METHOD_TERMS,
  parseInvoiceLineItems,
  fmtMoney,
} from "@/lib/custom-invoice";

const APP_NAME = "Revive Design Collective";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const INVOICE_SELECT =
  "id, invoice_number, client_id, stage_id, bill_to_name, bill_to_email, bill_to_address, title, reference, line_items, discount, total, invoice_date, due_date, payment_terms, notes, include_staging_terms, status, pdf_url, sent_at";

/** Build the PDF, upload it, and stamp pdf_url on the invoice. */
export async function generateCustomInvoicePdf(
  supabase: SupabaseClient,
  invoiceId: string,
): Promise<{ url: string }> {
  const { data: inv, error } = await supabase
    .from("invoices")
    .select(INVOICE_SELECT)
    .eq("id", invoiceId)
    .single();
  if (error || !inv) throw new Error(error?.message || "Invoice not found");

  const items = parseInvoiceLineItems(inv.line_items);

  // Optional standard staging terms (split stage billing wants them; a
  // furniture sale doesn't). Payment-method lines always print.
  let terms: string[] = [...PAYMENT_METHOD_TERMS];
  if (inv.include_staging_terms) {
    try {
      const tmpl = await getContractTemplate();
      terms = [...PAYMENT_METHOD_TERMS, ...tmpl.terms.map((t) => t.body)];
    } catch {
      // defaults are fine
    }
  }

  const pdfBytes = await generateInvoicePdf({
    companyName: APP_NAME,
    layout: "custom",
    invoiceNumber: inv.invoice_number,
    invoiceDate: inv.invoice_date,
    dueDate: inv.due_date ?? null,
    clientName: inv.bill_to_name,
    clientEmail: inv.bill_to_email ?? null,
    clientAddress: inv.bill_to_address ?? null,
    title: inv.title,
    reference: inv.reference ?? null,
    lineItems: items.map((i) => ({
      label: i.description,
      amount: i.amount,
      qty: i.qty,
      unitPrice: i.unit_price,
    })),
    discount: Number(inv.discount ?? 0),
    total: Number(inv.total ?? 0),
    paymentTerms: inv.payment_terms ?? null,
    notes: inv.notes ?? null,
    paymentInstructions: null,
    packageIncludesNote: null,
    terms,
  });

  // Unguessable path; never overwrite an earlier version (a client may
  // still hold the old link).
  const path = `invoices/custom-${inv.id}-${Date.now()}.pdf`;
  const { error: upErr } = await supabase.storage
    .from("contracts")
    .upload(path, pdfBytes, { contentType: "application/pdf", upsert: false });
  if (upErr) throw new Error(upErr.message);
  const { data: urlData } = supabase.storage.from("contracts").getPublicUrl(path);

  await supabase
    .from("invoices")
    .update({
      pdf_url: urlData.publicUrl,
      pdf_generated_at: new Date().toISOString(),
    })
    .eq("id", inv.id);

  return { url: urlData.publicUrl };
}

export type CustomInvoiceEmailResult =
  | { ok: true; pdfUrl: string }
  | { ok: false; error: string };

/**
 * Email the invoice to its Bill To address (BCC all admins), generating
 * the PDF first if there isn't one. Moves draft → sent and stamps
 * sent_at; a resend on an already-sent invoice just refreshes sent_at.
 */
export async function sendCustomInvoiceEmail(
  supabase: SupabaseClient,
  invoiceId: string,
): Promise<CustomInvoiceEmailResult> {
  try {
    if (!isEmailConfigured()) {
      return { ok: false, error: "Email isn't configured — set RESEND_API_KEY and EMAIL_FROM." };
    }
    const { data: inv, error } = await supabase
      .from("invoices")
      .select(INVOICE_SELECT)
      .eq("id", invoiceId)
      .single();
    if (error || !inv) throw new Error(error?.message || "Invoice not found");
    if (inv.status === "void") {
      return { ok: false, error: "This invoice is void — un-void it first." };
    }
    const to = String(inv.bill_to_email ?? "").trim();
    if (!to) {
      return { ok: false, error: "No email on this invoice — add one under Bill To first." };
    }

    // Always regenerate on send so the PDF reflects the latest edits.
    const { url: pdfUrl } = await generateCustomInvoicePdf(supabase, inv.id);

    const { data: admins } = await supabase
      .from("profiles")
      .select("email")
      .eq("role", "admin");
    const bcc = (admins ?? [])
      .map((a: { email: string | null }) => a.email)
      .filter((e): e is string => !!e && e.toLowerCase() !== to.toLowerCase())
      .slice(0, 50);

    const total = fmtMoney(Number(inv.total ?? 0));
    const greeting = String(inv.bill_to_name ?? "").split(/\s+/)[0] || "there";
    const what = inv.reference ? `${inv.title} — ${inv.reference}` : inv.title;
    const subject = `Invoice ${inv.invoice_number}: ${inv.title} — ${APP_NAME}`;
    const text =
      `Hi ${greeting},\n\n` +
      `Here's your invoice from ${APP_NAME} for ${what}.\n\n` +
      `Invoice PDF: ${pdfUrl}\n\n` +
      `Total: ${total}` +
      (inv.payment_terms ? `\n${inv.payment_terms}` : "") +
      `\n\nPayment by check / cash / Zelle — details on the invoice.` +
      `\n\nReach out if you have any questions.\n\n${APP_NAME}`;
    const html = `
      <div style="font-family: -apple-system, system-ui, sans-serif; color: #0f172a; max-width: 560px; margin: 0 auto;">
        <p>Hi ${escapeHtml(greeting)},</p>
        <p>Here's your invoice from ${APP_NAME} for <strong>${escapeHtml(what)}</strong>.</p>
        ${emailButton({ href: pdfUrl, label: "View invoice PDF" })}
        <p><strong>Total: ${escapeHtml(total)}</strong>${
          inv.payment_terms
            ? `<br /><span style="color:#475569; font-size:14px;">${escapeHtml(inv.payment_terms)}</span>`
            : ""
        }</p>
        <p style="color:#475569; font-size:14px;">Payment by check / cash / Zelle — details on the invoice.</p>
        <p style="color:#475569; font-size:14px;">Reach out if you have any questions.</p>
        <p style="color:#475569; font-size:14px;">— ${APP_NAME}</p>
      </div>`;

    await sendEmail({
      to,
      ...(bcc.length > 0 ? { bcc } : {}),
      subject,
      text,
      html,
    });

    await supabase
      .from("invoices")
      .update({
        sent_at: new Date().toISOString(),
        ...(inv.status === "draft" ? { status: "sent" } : {}),
      })
      .eq("id", inv.id);

    return { ok: true, pdfUrl };
  } catch (e: unknown) {
    console.error("[custom-invoice-email] failed:", e);
    return { ok: false, error: e instanceof Error && e.message ? e.message : "Send failed" };
  }
}

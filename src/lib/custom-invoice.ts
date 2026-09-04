/**
 * Shared shapes + helpers for standalone invoices (public.invoices) —
 * cleaning fees, furniture sales, split stage billing. Kept free of
 * Supabase/React imports so the PDF renderer, the server actions, and
 * the client-side form can all use the same math.
 */

export type InvoiceLineItem = {
  description: string;
  qty: number;
  unit_price: number;
  /** qty × unit_price, rounded to cents. Stored so the PDF and the DB
   *  total can never disagree over rounding. */
  amount: number;
};

export type InvoiceStatus = "draft" | "sent" | "paid" | "void";

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  paid: "Paid",
  void: "Void",
};

/** Where to send the money — the one place this text lives. Printed on
 *  every invoice (stage, extension, fee, and custom). */
export const PAYMENT_METHOD_TERMS: readonly string[] = [
  "Please make checks payable to: Revive Design Collective, 220 Sandburg Drive, Sacramento, CA 95819.",
  "Zelle: 530-251-3898 (Williams Real Estate Services).",
];

export const DEFAULT_INVOICE_PAYMENT_TERMS = "Payment due upon receipt.";

const MAX_LINE_ITEMS = 50;
const MAX_DESCRIPTION_LEN = 200;
const MAX_QTY = 10000;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Sanitize line items from either a jsonb value (already an array) or
 * the form's JSON string. Drops malformed rows, clamps lengths, and
 * recomputes `amount` from qty × unit_price so a tampered payload can't
 * carry a made-up total.
 */
export function parseInvoiceLineItems(raw: unknown): InvoiceLineItem[] {
  let arr: unknown = raw;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  const out: InvoiceLineItem[] = [];
  for (const item of arr) {
    if (out.length >= MAX_LINE_ITEMS) break;
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const description = String(o.description ?? "").trim().slice(0, MAX_DESCRIPTION_LEN);
    if (!description) continue;
    let qty = Number(o.qty ?? 1);
    if (!Number.isFinite(qty) || qty <= 0) qty = 1;
    qty = Math.min(qty, MAX_QTY);
    const unit = Number(o.unit_price ?? o.price ?? 0);
    if (!Number.isFinite(unit) || unit < 0) continue;
    out.push({
      description,
      qty,
      unit_price: round2(unit),
      amount: round2(qty * unit),
    });
  }
  return out;
}

export function invoiceSubtotal(items: InvoiceLineItem[]): number {
  return round2(items.reduce((s, i) => s + i.amount, 0));
}

export function invoiceTotal(items: InvoiceLineItem[], discount: number): number {
  const d = Number.isFinite(discount) && discount > 0 ? discount : 0;
  return Math.max(round2(invoiceSubtotal(items) - d), 0);
}

export function fmtMoney(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

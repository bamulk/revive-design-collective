import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/require-admin";
import BackLink from "@/components/BackLink";
import InvoiceStatusBadge from "@/components/InvoiceStatusBadge";
import InvoiceActions from "@/components/InvoiceActions";
import InvoicePaymentsSection, {
  type InvoicePaymentRow,
} from "@/components/InvoicePaymentsSection";
import { formatMDY } from "@/lib/time";
import { fmtMoney, parseInvoiceLineItems } from "@/lib/custom-invoice";

export const dynamic = "force-dynamic";

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: inv }, { data: pays }] = await Promise.all([
    supabase
      .from("invoices")
      .select(
        "id, invoice_number, status, client_id, stage_id, bill_to_name, bill_to_email, bill_to_address, title, reference, line_items, discount, total, invoice_date, due_date, payment_terms, notes, include_staging_terms, pdf_url, pdf_generated_at, sent_at, paid_at, created_at, client:clients(id, name), stage:stages(id, address, city)",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("invoice_payments")
      .select("id, amount, paid_at, method, note")
      .eq("invoice_id", id)
      .order("paid_at", { ascending: false })
      .order("created_at", { ascending: false }),
  ]);
  if (!inv) notFound();

  const client = (Array.isArray(inv.client) ? inv.client[0] : inv.client) as
    | { id: string; name: string }
    | null;
  const stage = (Array.isArray(inv.stage) ? inv.stage[0] : inv.stage) as
    | { id: string; address: string; city: string | null }
    | null;
  const items = parseInvoiceLineItems(inv.line_items);
  const payments: InvoicePaymentRow[] = (
    (pays ?? []) as {
      id: string;
      amount: number | string | null;
      paid_at: string;
      method: string | null;
      note: string | null;
    }[]
  ).map((p) => ({
    id: p.id,
    amount: Number(p.amount ?? 0),
    paid_at: p.paid_at,
    method: p.method ?? null,
    note: p.note ?? null,
  }));
  const subtotal = items.reduce((s, i) => s + i.amount, 0);

  return (
    <div className="space-y-6 max-w-3xl">
      <BackLink
        fallback="/invoices"
        className="text-sm text-slate-700 dark:text-slate-300 hover:underline"
      >
        ← Back
      </BackLink>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-semibold truncate">{inv.title}</h1>
            <InvoiceStatusBadge status={inv.status} />
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400 font-mono mt-0.5">
            {inv.invoice_number} · issued {formatMDY(inv.invoice_date)}
            {inv.due_date ? ` · due ${formatMDY(inv.due_date)}` : ""}
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-semibold tabular-nums">{fmtMoney(Number(inv.total))}</div>
          {inv.paid_at && (
            <div className="text-xs text-emerald-700 dark:text-emerald-300">
              Paid {formatMDY(String(inv.paid_at).slice(0, 10))}
            </div>
          )}
        </div>
      </div>

      <section className="bg-white dark:bg-slate-900 border rounded-xl p-5 space-y-3">
        <InvoiceActions
          invoiceId={inv.id}
          status={inv.status}
          pdfUrl={inv.pdf_url ?? null}
          hasEmail={!!(inv.bill_to_email && String(inv.bill_to_email).trim())}
          hasPayments={payments.length > 0}
          sentAt={inv.sent_at ?? null}
        />
        <div className="text-xs text-slate-500 dark:text-slate-400 space-x-3">
          {inv.sent_at ? (
            <span>Emailed {formatMDY(String(inv.sent_at).slice(0, 10))}</span>
          ) : inv.status !== "void" ? (
            <span>Not emailed yet.</span>
          ) : null}
          {inv.pdf_generated_at && (
            <span>PDF built {formatMDY(String(inv.pdf_generated_at).slice(0, 10))}</span>
          )}
        </div>
        {inv.status === "paid" && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Paid invoices are frozen. Delete a payment below to reopen it for edits.
          </p>
        )}
      </section>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <section className="bg-white dark:bg-slate-900 border rounded-xl p-5 space-y-1 text-sm">
          <h2 className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Bill to
          </h2>
          <div className="font-medium text-slate-900 dark:text-slate-100">{inv.bill_to_name}</div>
          {inv.bill_to_email && (
            <div className="text-slate-600 dark:text-slate-400">{inv.bill_to_email}</div>
          )}
          {inv.bill_to_address && (
            <div className="text-slate-600 dark:text-slate-400 whitespace-pre-line">
              {inv.bill_to_address}
            </div>
          )}
          {client && (
            <div className="pt-2">
              <Link
                href={`/clients/${client.id}`}
                className="text-xs text-brand hover:underline"
              >
                Client: {client.name}
              </Link>
            </div>
          )}
          {!client && (
            <div className="pt-2 text-xs text-slate-500 dark:text-slate-400">
              Not tied to a client.
            </div>
          )}
        </section>

        <section className="bg-white dark:bg-slate-900 border rounded-xl p-5 space-y-1 text-sm">
          <h2 className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Details
          </h2>
          {inv.reference && (
            <div className="text-slate-900 dark:text-slate-100">{inv.reference}</div>
          )}
          {stage && (
            <div>
              <Link
                href={`/stages/${stage.id}`}
                className="text-xs text-brand hover:underline"
              >
                Linked stage: {stage.address}
              </Link>
            </div>
          )}
          <div className="text-slate-600 dark:text-slate-400">
            {inv.payment_terms || "—"}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 pt-1">
            {inv.include_staging_terms
              ? "Standard staging terms included."
              : "Payment details only — no staging terms."}
          </div>
        </section>
      </div>

      <section className="bg-white dark:bg-slate-900 border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800/50 text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
            <tr>
              <th className="text-left font-medium px-4 py-2">Description</th>
              <th className="text-right font-medium px-4 py-2 w-20">Qty</th>
              <th className="text-right font-medium px-4 py-2 w-28">Unit</th>
              <th className="text-right font-medium px-4 py-2 w-28">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {items.map((li, i) => (
              <tr key={i}>
                <td className="px-4 py-2 text-slate-900 dark:text-slate-100">{li.description}</td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-600 dark:text-slate-400">
                  {Number.isInteger(li.qty) ? li.qty : li.qty.toFixed(2)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-600 dark:text-slate-400">
                  {fmtMoney(li.unit_price)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{fmtMoney(li.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="text-sm">
            {Number(inv.discount) > 0 && (
              <>
                <tr>
                  <td colSpan={3} className="px-4 pt-3 text-right text-slate-500">Subtotal</td>
                  <td className="px-4 pt-3 text-right tabular-nums">{fmtMoney(subtotal)}</td>
                </tr>
                <tr>
                  <td colSpan={3} className="px-4 py-1 text-right text-slate-500">Discount</td>
                  <td className="px-4 py-1 text-right tabular-nums text-slate-500">
                    -{fmtMoney(Number(inv.discount))}
                  </td>
                </tr>
              </>
            )}
            <tr className="font-semibold">
              <td colSpan={3} className="px-4 py-3 text-right">Total</td>
              <td className="px-4 py-3 text-right tabular-nums">{fmtMoney(Number(inv.total))}</td>
            </tr>
          </tfoot>
        </table>
        {inv.notes && (
          <div className="border-t border-slate-100 dark:border-slate-800 px-4 py-3 text-sm text-slate-600 dark:text-slate-400 whitespace-pre-line">
            {inv.notes}
          </div>
        )}
      </section>

      <InvoicePaymentsSection
        invoiceId={inv.id}
        total={Number(inv.total)}
        payments={payments}
        readOnly={inv.status === "void"}
      />
    </div>
  );
}

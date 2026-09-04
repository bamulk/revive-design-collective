import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import CollapsibleSection from "@/components/CollapsibleSection";
import InvoiceStatusBadge from "@/components/InvoiceStatusBadge";
import { formatMDY } from "@/lib/time";
import { fmtMoney } from "@/lib/custom-invoice";

/**
 * Open standalone invoices (cleaning, furniture, split billing) with a
 * balance still due. Sits under the stage-invoice Outstanding block;
 * admin-only like its siblings.
 */
type OpenRow = {
  id: string;
  invoice_number: string;
  title: string;
  reference: string | null;
  bill_to_name: string;
  total: number | string | null;
  status: string;
  invoice_date: string;
  due_date: string | null;
  sent_at: string | null;
};

export default async function OutstandingCustomInvoicesSection() {
  const supabase = await createClient();
  const { data: open } = await supabase
    .from("invoices")
    .select("id, invoice_number, title, reference, bill_to_name, total, status, invoice_date, due_date, sent_at")
    .in("status", ["draft", "sent"])
    .gt("total", 0)
    .order("invoice_date", { ascending: true });

  const openRows = (open ?? []) as OpenRow[];
  const ids = openRows.map((i) => i.id);
  const paidById = new Map<string, number>();
  if (ids.length > 0) {
    const { data: pays } = await supabase
      .from("invoice_payments")
      .select("invoice_id, amount")
      .in("invoice_id", ids);
    for (const p of (pays ?? []) as { invoice_id: string; amount: number | string | null }[]) {
      paidById.set(p.invoice_id, (paidById.get(p.invoice_id) ?? 0) + Number(p.amount ?? 0));
    }
  }

  const rows = openRows
    .map((i) => ({
      ...i,
      total: Number(i.total ?? 0),
      balance: Math.max(Number(i.total ?? 0) - (paidById.get(i.id) ?? 0), 0),
    }))
    .filter((r) => r.balance > 0);
  const total = rows.reduce((s, r) => s + r.balance, 0);

  return (
    <CollapsibleSection
      id="outstanding-invoices"
      title="Other invoices"
      defaultOpen={false}
      subtitle={
        rows.length > 0
          ? `${fmtMoney(total)} across ${rows.length} invoice${rows.length === 1 ? "" : "s"}`
          : "All caught up"
      }
      right={
        <Link href="/invoices" className="text-xs text-brand hover:underline">
          All invoices
        </Link>
      }
    >
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400 italic px-1">
          No cleaning, furniture, or split invoices outstanding.
        </p>
      ) : (
        <div className="bg-white dark:bg-slate-900 border rounded-xl divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden">
          {rows.map((r) => (
            <Link
              key={r.id}
              href={`/invoices/${r.id}`}
              className="block p-3 sm:p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50"
            >
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-slate-900 dark:text-slate-100 truncate">
                      {r.title}
                    </span>
                    <InvoiceStatusBadge status={r.status} />
                  </div>
                  <div className="text-sm text-slate-600 dark:text-slate-400 truncate">
                    {r.bill_to_name}
                    {r.reference ? ` · ${r.reference}` : ""}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                    {r.invoice_number} · {formatMDY(r.invoice_date)}
                    {r.due_date ? ` · due ${formatMDY(r.due_date)}` : ""}
                    {!r.sent_at ? " · not sent" : ""}
                  </div>
                </div>
                <div className="text-right shrink-0 font-semibold tabular-nums">
                  {fmtMoney(r.balance)}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </CollapsibleSection>
  );
}

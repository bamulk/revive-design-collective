import Link from "next/link";
import { PlusCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import InvoiceStatusBadge from "@/components/InvoiceStatusBadge";
import { formatMDY } from "@/lib/time";
import { fmtMoney } from "@/lib/custom-invoice";

/**
 * Standalone invoices linked to this stage — split billing, a cleaning
 * charge after destage, etc. Separate from the stage's own invoice
 * card above. Admin-only; streams in under Suspense.
 */
export default async function StageInvoices({ stageId }: { stageId: string }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("invoices")
    .select("id, invoice_number, title, bill_to_name, total, status, invoice_date, sent_at")
    .eq("stage_id", stageId)
    .order("invoice_date", { ascending: false });
  type Row = {
    id: string;
    invoice_number: string;
    title: string;
    bill_to_name: string;
    total: number | string | null;
    status: string;
    invoice_date: string;
    sent_at: string | null;
  };
  const rows = (data ?? []) as Row[];

  return (
    <section className="bg-white dark:bg-slate-900 border rounded-xl p-5 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold tracking-tight">Other invoices</h2>
        <Link
          href={`/invoices/new?stage=${stageId}`}
          className="inline-flex items-center gap-1 text-sm text-brand hover:underline"
        >
          <PlusCircle size={14} /> New invoice for this stage
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          None yet. Use this to split the stage across two payers or bill a
          cleaning fee after destage.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map((r) => (
            <li key={r.id}>
              <Link
                href={`/invoices/${r.id}`}
                className="py-2.5 flex items-center justify-between gap-3 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50 -mx-2 px-2 rounded"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-slate-900 dark:text-slate-100 truncate">
                      {r.title}
                    </span>
                    <InvoiceStatusBadge status={r.status} />
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {r.bill_to_name} · {r.invoice_number} · {formatMDY(r.invoice_date)}
                    {!r.sent_at && r.status === "draft" ? " · not sent" : ""}
                  </div>
                </div>
                <span className="font-medium tabular-nums shrink-0">
                  {fmtMoney(Number(r.total ?? 0))}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

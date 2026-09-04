import Link from "next/link";
import { PlusCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/fetch-all";
import { PageHeader, LinkButton, Card } from "@/components/ui";
import { requireAdmin } from "@/lib/require-admin";
import { formatMDY } from "@/lib/time";
import { fmtMoney } from "@/lib/custom-invoice";
import InvoiceStatusBadge from "@/components/InvoiceStatusBadge";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  invoice_number: string;
  title: string;
  reference: string | null;
  bill_to_name: string;
  total: number;
  paid: number;
  status: string;
  invoice_date: string;
  due_date: string | null;
  sent_at: string | null;
  client_id: string | null;
  stage_id: string | null;
};

/**
 * Standalone invoices — cleaning, furniture sales, split stage billing.
 * Stage invoices themselves still live on the stage page; this list is
 * everything that isn't the one-per-stage invoice.
 */
export default async function InvoicesPage() {
  await requireAdmin();
  const supabase = await createClient();

  const invoices = await fetchAllRows((from, to) =>
    supabase
      .from("invoices")
      .select(
        "id, invoice_number, title, reference, bill_to_name, total, status, invoice_date, due_date, sent_at, client_id, stage_id",
      )
      .order("invoice_date", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, to),
  );

  // Paid-so-far per invoice, for the balance column.
  const ids = (invoices ?? []).map((i) => i.id as string);
  const paidById = new Map<string, number>();
  if (ids.length > 0) {
    const pays = await fetchAllRows((from, to) =>
      supabase
        .from("invoice_payments")
        .select("invoice_id, amount")
        .in("invoice_id", ids)
        .order("id")
        .range(from, to),
    );
    for (const p of (pays ?? []) as { invoice_id: string; amount: number | string | null }[]) {
      paidById.set(p.invoice_id, (paidById.get(p.invoice_id) ?? 0) + Number(p.amount ?? 0));
    }
  }

  const rows: Row[] = ((invoices ?? []) as Record<string, unknown>[]).map((i) => ({
    id: String(i.id),
    invoice_number: String(i.invoice_number),
    title: String(i.title),
    reference: (i.reference as string | null) ?? null,
    bill_to_name: String(i.bill_to_name),
    total: Number(i.total ?? 0),
    paid: paidById.get(String(i.id)) ?? 0,
    status: String(i.status),
    invoice_date: String(i.invoice_date),
    due_date: (i.due_date as string | null) ?? null,
    sent_at: (i.sent_at as string | null) ?? null,
    client_id: (i.client_id as string | null) ?? null,
    stage_id: (i.stage_id as string | null) ?? null,
  }));

  const open = rows.filter((r) => r.status === "draft" || r.status === "sent");
  const closed = rows.filter((r) => r.status === "paid" || r.status === "void");
  const openBalance = open.reduce((s, r) => s + Math.max(r.total - r.paid, 0), 0);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Invoices"
        subtitle={
          open.length > 0
            ? `${open.length} open · ${fmtMoney(openBalance)} outstanding`
            : "No open invoices"
        }
        actions={
          <LinkButton href="/invoices/new">
            <PlusCircle size={14} /> New invoice
          </LinkButton>
        }
      />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Open</h2>
        {open.length === 0 ? (
          <Card className="p-6 text-sm text-slate-600 dark:text-slate-400 text-center">
            Nothing open.{" "}
            <Link href="/invoices/new" className="text-brand underline">
              Create an invoice
            </Link>{" "}
            for a cleaning fee, a furniture sale, or part of a stage.
          </Card>
        ) : (
          <InvoiceList rows={open} />
        )}
      </section>

      {closed.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">Paid &amp; void</h2>
          <InvoiceList rows={closed} />
        </section>
      )}
    </div>
  );
}

function InvoiceList({ rows }: { rows: Row[] }) {
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden">
      {rows.map((r) => {
        const balance = Math.max(r.total - r.paid, 0);
        return (
          <Link
            key={r.id}
            href={`/invoices/${r.id}`}
            className="block p-3 sm:p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition"
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
                <div className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-0.5">
                  {r.invoice_number} · {formatMDY(r.invoice_date)}
                  {r.due_date ? ` · due ${formatMDY(r.due_date)}` : ""}
                  {r.sent_at ? "" : r.status === "draft" ? " · not sent" : ""}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                  {fmtMoney(r.total)}
                </div>
                {r.status !== "void" && r.paid > 0 && balance > 0 && (
                  <div className="text-xs text-rose-700 dark:text-rose-300 tabular-nums">
                    {fmtMoney(balance)} due
                  </div>
                )}
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

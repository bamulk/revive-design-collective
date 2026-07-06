import { createClient } from "@/lib/supabase/server";
import CollapsibleSection from "@/components/CollapsibleSection";
import OutstandingInvoicesList, {
  type OutstandingRow,
} from "@/components/OutstandingInvoicesList";

/**
 * Outstanding invoices block on the dashboard. Extracted into its own
 * async server component so the dashboard shell + status tiles paint
 * immediately while this query runs in parallel and streams in.
 *
 * Admin-only by design — the parent only renders this when isAdmin
 * so the financial info isn't even queried for stagers.
 */
export default async function OutstandingSection() {
  const supabase = await createClient();
  // amount > 0: internal stages (e.g. the owner's own listings) carry a
  // $0 amount by design — the team tracks the work but nothing is
  // billed, so they're not outstanding invoices.
  const { data: unpaidList } = await supabase
    .from("stages")
    .select(
      "id, address, amount, stage_date, destage_date, status, invoice_sent_at, clients(name, email)",
    )
    .is("paid_at", null)
    .gt("amount", 0)
    .neq("status", "cancelled")
    .neq("status", "scheduled")
    .order("stage_date", { ascending: true, nullsFirst: false });

  const outstandingTotal = (unpaidList ?? []).reduce(
    (sum, r: any) => sum + Number(r.amount ?? 0),
    0,
  );
  const outstandingCount = unpaidList?.length ?? 0;

  return (
    <CollapsibleSection
      id="outstanding"
      title="Outstanding invoices"
      defaultOpen={false}
      subtitle={
        outstandingCount > 0
          ? `$${outstandingTotal.toFixed(2)} across ${outstandingCount} stage${outstandingCount === 1 ? "" : "s"}`
          : "All caught up"
      }
    >
      {outstandingCount > 0 ? (
        <OutstandingInvoicesList
          isAdmin
          rows={(unpaidList ?? []).map(
            (s: any): OutstandingRow => ({
              id: s.id,
              address: s.address,
              amount: Number(s.amount ?? 0),
              status: s.status,
              stage_date: s.stage_date,
              destage_date: s.destage_date,
              client_name: s.clients?.name ?? null,
              client_email: s.clients?.email ?? null,
              invoice_sent_at: s.invoice_sent_at ?? null,
            }),
          )}
        />
      ) : (
        <p className="text-sm text-slate-500 dark:text-slate-400 italic px-1">
          Nothing unpaid right now. Nice.
        </p>
      )}
    </CollapsibleSection>
  );
}

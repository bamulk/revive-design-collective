import { createClient } from "@/lib/supabase/server";
import CollapsibleSection from "@/components/CollapsibleSection";
import OutstandingExtensionsList, {
  type OutstandingExtensionRow,
} from "@/components/OutstandingExtensionsList";

/**
 * Outstanding extensions block on the dashboard — the 30-day-extension
 * twin of the Outstanding invoices section right above it. Lists every
 * unpaid extension invoice with a quick Mark-as-paid. Streamed in via
 * Suspense; admin-only (parent gates on isAdmin).
 *
 * amount > 0 mirrors the invoices section's internal-stage rule —
 * nothing billed means nothing outstanding.
 */
export default async function OutstandingExtensionsSection() {
  const supabase = await createClient();
  const { data: unpaid } = await supabase
    .from("stage_extensions")
    .select(
      "id, stage_id, extension_date, amount, reminder_count, reminder_last_at, pdf_sent_at, stages(address, clients(id, name, email))",
    )
    .is("paid_at", null)
    .gt("amount", 0)
    .order("extension_date", { ascending: true, nullsFirst: false });

  const rows: OutstandingExtensionRow[] = (unpaid ?? []).map((x: any) => {
    const stage = Array.isArray(x.stages) ? x.stages[0] : x.stages;
    const client = Array.isArray(stage?.clients)
      ? stage.clients[0]
      : stage?.clients;
    return {
      id: x.id,
      stage_id: x.stage_id,
      address: stage?.address ?? "—",
      client_id: client?.id ?? null,
      client_name: client?.name ?? null,
      client_email: client?.email ?? null,
      pdf_sent_at: x.pdf_sent_at ?? null,
      extension_date: x.extension_date ?? null,
      amount: Number(x.amount ?? 0),
      reminder_count: Number(x.reminder_count ?? 0),
      reminder_last_at: x.reminder_last_at ?? null,
    };
  });

  const total = rows.reduce((sum, r) => sum + r.amount, 0);

  return (
    <CollapsibleSection
      id="outstanding-extensions"
      title="Outstanding extensions"
      defaultOpen={false}
      subtitle={
        rows.length > 0
          ? `$${total.toFixed(2)} across ${rows.length} extension${rows.length === 1 ? "" : "s"}`
          : "All caught up"
      }
    >
      {rows.length > 0 ? (
        <OutstandingExtensionsList rows={rows} />
      ) : (
        <p className="text-sm text-slate-500 dark:text-slate-400 italic px-1">
          No unpaid extensions right now. Nice.
        </p>
      )}
    </CollapsibleSection>
  );
}

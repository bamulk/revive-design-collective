import { createClient } from "@/lib/supabase/server";
import PaymentsSection, {
  type StagePaymentRow,
} from "@/components/PaymentsSection";

/**
 * Async server component that queries the per-stage payments ledger
 * and renders the admin PaymentsSection. Wrapped in Suspense in the
 * parent so it streams in independently — the rest of the page
 * doesn't wait for it.
 */
export default async function StagePayments({
  stageId,
  stageAmount,
}: {
  stageId: string;
  stageAmount: number;
}) {
  const supabase = await createClient();
  const { data: payments } = await supabase
    .from("stage_payments")
    .select("id, amount, paid_at, method, note, created_at")
    .eq("stage_id", stageId)
    .order("paid_at", { ascending: false });

  const rows: StagePaymentRow[] = (payments ?? []).map((p: any) => ({
    id: p.id,
    amount: Number(p.amount ?? 0),
    paid_at: p.paid_at,
    method: p.method ?? null,
    note: p.note ?? null,
    created_at: p.created_at,
  }));

  return (
    <PaymentsSection
      stageId={stageId}
      stageAmount={stageAmount}
      payments={rows}
    />
  );
}

/** Lightweight skeleton matching the PaymentsSection card shape. */
export function StagePaymentsFallback() {
  return (
    <div className="bg-white dark:bg-slate-900 border rounded-xl p-5 space-y-4">
      <div className="h-5 w-24 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
      <div className="grid grid-cols-3 gap-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div
            key={i}
            className="h-16 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse"
            style={{ animationDelay: `${i * 60}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

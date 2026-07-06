import Link from "next/link";
import { PlusCircle, Mail, Check, X } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/fetch-all";
import { PageHeader, LinkButton, Card } from "@/components/ui";
import { requireEstimateAccess } from "@/lib/permissions";
import { formatMDY } from "@/lib/time";

export const dynamic = "force-dynamic";

/** Estimates page formats dates as mm/dd/yy — same as everywhere else. */
const fmtDate = formatMDY;

export default async function EstimatesPage() {
  await requireEstimateAccess();
  const supabase = await createClient();

  // Pending estimates (status = 'estimate') + a recent history of accepted
  // and declined ones so the user can verify the loop closed. Nothing
  // forces a pending estimate to resolve, so stale ones accumulate —
  // page past the 1000-row cap.
  const pending = await fetchAllRows((from, to) =>
    supabase
      .from("stages")
      .select("id, address, amount, stage_date, estimate_sent_at, clients(name)")
      .eq("status", "estimate")
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, to),
  );

  const { data: recent } = await supabase
    .from("stages")
    .select(
      "id, address, amount, estimate_accepted_at, estimate_declined_at, clients(name), status"
    )
    .or("estimate_accepted_at.not.is.null,estimate_declined_at.not.is.null")
    .order("estimate_accepted_at", { ascending: false, nullsFirst: false })
    .limit(20);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Estimates"
        subtitle={`${pending?.length ?? 0} pending`}
        actions={
          <LinkButton href="/estimates/new">
            <PlusCircle size={14} /> New estimate
          </LinkButton>
        }
      />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Pending</h2>
        {(pending?.length ?? 0) === 0 ? (
          <Card className="p-6 text-sm text-slate-600 dark:text-slate-400 text-center">
            No pending estimates.{" "}
            <Link href="/estimates/new" className="text-brand underline">
              Create one
            </Link>
            .
          </Card>
        ) : (
          <div className="space-y-2">
            {(pending ?? []).map((e: any) => (
              <Link
                key={e.id}
                href={`/estimates/${e.id}`}
                className="block bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4 hover:shadow-sm transition"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900 dark:text-slate-100 truncate">
                      {e.address}
                    </div>
                    <div className="text-xs text-slate-600 dark:text-slate-400 truncate">
                      {e.clients?.name ?? "—"} · stage {fmtDate(e.stage_date)}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 inline-flex items-center gap-1">
                      <Mail size={11} />
                      {e.estimate_sent_at
                        ? `Sent ${formatMDY(e.estimate_sent_at)}`
                        : "Not sent yet"}
                    </div>
                  </div>
                  <div className="text-sm font-medium tabular-nums shrink-0">
                    ${Number(e.amount).toFixed(2)}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {recent && recent.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">
            Recent decisions
          </h2>
          <div className="space-y-2">
            {recent.map((e: any) => {
              const accepted = !!e.estimate_accepted_at;
              return (
                <div
                  key={e.id}
                  className="flex items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4"
                >
                  <div className="min-w-0">
                    <Link
                      href={
                        accepted
                          ? `/stages/${e.id}`
                          : `/estimates/${e.id}`
                      }
                      className="font-medium text-slate-900 dark:text-slate-100 truncate hover:text-brand"
                    >
                      {e.address}
                    </Link>
                    <div className="text-xs text-slate-600 dark:text-slate-400 truncate">
                      {e.clients?.name ?? "—"} · $
                      {Number(e.amount).toFixed(2)}
                    </div>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium ring-1 ring-inset ${
                      accepted
                        ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                        : "bg-rose-50 text-rose-700 ring-rose-200"
                    }`}
                  >
                    {accepted ? <Check size={12} /> : <X size={12} />}
                    {accepted
                      ? `Accepted ${formatMDY(e.estimate_accepted_at)}`
                      : `Declined ${formatMDY(e.estimate_declined_at)}`}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

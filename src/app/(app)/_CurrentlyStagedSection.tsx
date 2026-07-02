import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui";
import CollapsibleSection from "@/components/CollapsibleSection";
import { formatMDY, todayPacificISO } from "@/lib/time";

/**
 * Currently-staged list on the dashboard, extracted as its own async
 * server component for streaming. Oldest-first so the houses sitting
 * the longest float to the top.
 */
export default async function CurrentlyStagedSection() {
  const supabase = await createClient();
  const { data: stagedList } = await supabase
    .from("stages")
    .select("id, address, stage_date, created_at, clients(name)")
    .eq("status", "staged")
    .order("stage_date", { ascending: true, nullsFirst: false });

  const todayISO = todayPacificISO();
  function daysBetween(fromISO: string, toISO: string) {
    const from = new Date(fromISO + "T00:00:00Z").getTime();
    const to = new Date(toISO + "T00:00:00Z").getTime();
    return Math.max(0, Math.round((to - from) / 86400000));
  }
  const stagedWithDays = (stagedList ?? []).map((s: any) => {
    const baseDate =
      s.stage_date ?? (s.created_at ? s.created_at.slice(0, 10) : null);
    return {
      ...s,
      days: baseDate ? daysBetween(baseDate, todayISO) : null,
    };
  });

  return (
    <CollapsibleSection
      id="staged"
      title="Currently staged"
      defaultOpen={false}
      subtitle={`Oldest first · ${stagedWithDays.length} house${stagedWithDays.length === 1 ? "" : "s"}`}
    >
      {/* Mobile: stacked cards */}
      <div className="md:hidden space-y-2">
        {stagedWithDays.map((s: any) => (
          <Link
            key={s.id}
            href={`/stages/${s.id}`}
            className="block bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-3 shadow-sm hover:shadow active:bg-slate-50 transition"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-slate-900 dark:text-slate-100 truncate">
                  {s.address}
                </div>
                <div className="text-xs text-slate-600 dark:text-slate-400 truncate">
                  {s.clients?.name ?? "—"}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Staged {formatMDY(s.stage_date)}
                </div>
              </div>
              <div className="shrink-0">
                {s.days == null ? (
                  <span className="text-slate-400 dark:text-slate-500 text-xs">—</span>
                ) : (
                  <DaysStagedBadge days={s.days} />
                )}
              </div>
            </div>
          </Link>
        ))}
        {stagedWithDays.length === 0 && (
          <Card className="p-8 text-center text-slate-500 dark:text-slate-400 text-sm">
            Nothing is currently staged.
          </Card>
        )}
      </div>

      {/* Desktop: full table */}
      <Card className="hidden md:block overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/80 text-left border-b border-slate-200 dark:border-slate-700/70">
              <tr className="text-xs uppercase tracking-wide text-slate-600 dark:text-slate-400">
                <th className="p-3 font-medium">Address</th>
                <th className="p-3 font-medium">Client</th>
                <th className="p-3 font-medium">Staged on</th>
                <th className="p-3 font-medium text-right">Days staged</th>
              </tr>
            </thead>
            <tbody>
              {stagedWithDays.map((s: any) => (
                <tr
                  key={s.id}
                  className="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900/60"
                >
                  <td className="p-3">
                    <Link
                      href={`/stages/${s.id}`}
                      className="font-medium text-slate-900 dark:text-slate-100 hover:text-brand"
                    >
                      {s.address}
                    </Link>
                  </td>
                  <td className="p-3 text-slate-700 dark:text-slate-300">
                    {s.clients?.name ?? "—"}
                  </td>
                  <td className="p-3 text-slate-700 dark:text-slate-300">
                    {formatMDY(s.stage_date)}
                  </td>
                  <td className="p-3 text-right">
                    {s.days == null ? (
                      <span className="text-slate-400 dark:text-slate-500">—</span>
                    ) : (
                      <DaysStagedBadge days={s.days} />
                    )}
                  </td>
                </tr>
              ))}
              {stagedWithDays.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="p-8 text-center text-slate-500 dark:text-slate-400"
                  >
                    Nothing is currently staged.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </CollapsibleSection>
  );
}

function DaysStagedBadge({ days }: { days: number }) {
  const tone =
    days <= 30
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : days <= 60
      ? "bg-amber-50 text-amber-800 ring-amber-200"
      : days <= 90
      ? "bg-orange-50 text-orange-800 ring-orange-200"
      : "bg-rose-50 text-rose-700 ring-rose-200";
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ring-1 ring-inset tabular-nums ${tone}`}
    >
      {days} day{days === 1 ? "" : "s"}
    </span>
  );
}

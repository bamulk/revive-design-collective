import Link from "next/link";
import { CalendarCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import CollapsibleSection from "@/components/CollapsibleSection";
import { formatMDY, todayPacificISO } from "@/lib/time";

/**
 * "Contingency removals" panel on the dashboard — every active stage
 * with a contingency-removal date on file, soonest first, so the team
 * can see which deals are about to firm up (and which dates already
 * passed). Admins enter the date on the stage page; the section hides
 * itself when no stage has one.
 */
export default async function ContingencyRemovalsSection() {
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("stages")
    .select(
      "id, address, city, contingency_removal_date, stage_date, clients(name)",
    )
    .not("contingency_removal_date", "is", null)
    .in("status", ["scheduled", "staged"])
    .order("contingency_removal_date", { ascending: true });

  const list = (rows ?? []) as any[];
  if (list.length === 0) return null;

  // Day-diff against the Pacific calendar day (both parse as UTC
  // midnight, so the subtraction is whole days).
  const todayMs = new Date(todayPacificISO()).getTime();

  return (
    <CollapsibleSection
      id="contingency-removals"
      title="Contingency removals"
      defaultOpen
      subtitle={`${list.length} stage${list.length === 1 ? "" : "s"} with a date on file — soonest first`}
    >
      <div className="space-y-2">
        {list.map((s) => {
          const days = Math.round(
            (new Date(String(s.contingency_removal_date)).getTime() -
              todayMs) /
              86400000,
          );
          const tone =
            days < 0
              ? "bg-rose-100 text-rose-800 ring-rose-200 dark:bg-rose-950/50 dark:text-rose-200 dark:ring-rose-900/60"
              : days <= 7
                ? "bg-amber-100 text-amber-800 ring-amber-200 dark:bg-amber-950/50 dark:text-amber-200 dark:ring-amber-900/60"
                : "bg-emerald-100 text-emerald-800 ring-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-200 dark:ring-emerald-900/60";
          const label =
            days === 0 ? "Today" : days < 0 ? `${Math.abs(days)}d ago` : `in ${days}d`;
          return (
            <Link
              key={s.id}
              href={`/stages/${s.id}`}
              className="block rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/60 p-3 shadow-sm transition"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-slate-900 dark:text-slate-100 truncate">
                    {s.address}
                  </div>
                  <div className="text-xs text-slate-600 dark:text-slate-400 truncate">
                    {[s.city, s.clients?.name].filter(Boolean).join(" · ") ||
                      "—"}
                  </div>
                </div>
                <span
                  className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ring-1 ring-inset tabular-nums ${tone}`}
                >
                  {label}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-600 dark:text-slate-400 tabular-nums">
                <span className="inline-flex items-center gap-1 font-medium text-slate-700 dark:text-slate-300">
                  <CalendarCheck size={11} />
                  Contingencies removed {formatMDY(s.contingency_removal_date)}
                </span>
                {s.stage_date && <span>Staged {formatMDY(s.stage_date)}</span>}
              </div>
            </Link>
          );
        })}
      </div>
    </CollapsibleSection>
  );
}

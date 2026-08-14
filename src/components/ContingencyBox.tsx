"use client";

import { useEffect, useState } from "react";
import { CalendarCheck, Loader2 } from "lucide-react";
import { updateContingencyDateAction } from "@/app/(app)/stages/actions";

/** "2026-08-20" -> "Wed, Aug 20" (noon anchor avoids TZ day-shift). */
function fmtDate(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** Whole days from today (local) to the date; negative = passed. */
function daysUntil(date: string, now: Date): number {
  const target = new Date(`${date}T12:00:00`).getTime();
  const today = new Date(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
      now.getDate(),
    ).padStart(2, "0")}T12:00:00`,
  ).getTime();
  return Math.round((target - today) / 86400000);
}

/**
 * Contingency-removal box on the stage page: the day the buyer's
 * contingencies lift on this sale. Admins set/change/clear it inline;
 * the team sees the date with a days-away pill (rose once passed,
 * amber inside a week). Hidden for non-admins when no date is set.
 * Mirrors PhotographerBox, minus the time-of-day and live countdown.
 */
export default function ContingencyBox({
  stageId,
  date,
  canEdit,
}: {
  stageId: string;
  date: string | null;
  canEdit: boolean;
}) {
  const [current, setCurrent] = useState<string | null>(date);
  const [editing, setEditing] = useState(false);
  const [inputVal, setInputVal] = useState(date ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Day-diff renders client-side only so server HTML never disagrees
  // with the first client paint across midnight.
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setCurrent(date);
    setInputVal(date ?? "");
  }, [date]);

  useEffect(() => {
    setNow(new Date());
  }, []);

  if (!current && !canEdit) return null;

  async function save(next: string | null) {
    setError(null);
    setPending(true);
    try {
      const r = await updateContingencyDateAction(stageId, next);
      if (r.ok) {
        setCurrent(next);
        setEditing(false);
      } else {
        setError(r.error);
      }
    } catch {
      setError("Couldn't save. Please try again.");
    } finally {
      setPending(false);
    }
  }

  const days = current && now ? daysUntil(current, now) : null;
  const pillTone =
    days == null
      ? ""
      : days < 0
        ? "bg-rose-100 text-rose-800 ring-rose-200 dark:bg-rose-950/50 dark:text-rose-200 dark:ring-rose-900/60"
        : days <= 7
          ? "bg-amber-100 text-amber-800 ring-amber-200 dark:bg-amber-950/50 dark:text-amber-200 dark:ring-amber-900/60"
          : "bg-emerald-100 text-emerald-800 ring-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-200 dark:ring-emerald-900/60";
  const pillLabel =
    days == null
      ? ""
      : days === 0
        ? "Today"
        : days < 0
          ? `${Math.abs(days)}d ago`
          : `in ${days}d`;

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 text-slate-600 dark:text-slate-300 shrink-0">
            <CalendarCheck size={15} />
          </span>
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Contingency removal
            </div>
            {current ? (
              <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                {fmtDate(current)}
              </div>
            ) : (
              <div className="text-sm text-slate-500 dark:text-slate-400 italic">
                Not set
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {current && days != null && (
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ring-1 ring-inset tabular-nums ${pillTone}`}
              title="Days until the buyer's contingencies are removed"
            >
              {pillLabel}
            </span>
          )}
          {canEdit && !editing && (
            <button
              type="button"
              onClick={() => {
                setError(null);
                setInputVal(current ?? "");
                setEditing(true);
              }}
              className="text-xs text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 underline decoration-dotted underline-offset-2"
            >
              {current ? "Edit" : "Set date"}
            </button>
          )}
        </div>
      </div>

      {canEdit && editing && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <input
            type="date"
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            disabled={pending}
            className="border border-slate-300 dark:border-slate-600 rounded px-3 py-2 text-sm bg-white dark:bg-slate-900"
          />
          <button
            type="button"
            onClick={() => {
              if (!inputVal) return;
              void save(inputVal);
            }}
            disabled={pending || !inputVal}
            className="inline-flex items-center gap-1.5 bg-slate-900 text-white dark:bg-white dark:text-slate-900 rounded-lg px-3 py-2 text-xs disabled:opacity-60"
          >
            {pending ? (
              <>
                <Loader2 size={12} className="animate-spin" /> Saving…
              </>
            ) : (
              "Save"
            )}
          </button>
          {current && (
            <button
              type="button"
              onClick={() => void save(null)}
              disabled={pending}
              className="text-xs text-rose-700 dark:text-rose-300 hover:underline disabled:opacity-60"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setError(null);
            }}
            disabled={pending}
            className="text-xs text-slate-600 dark:text-slate-400 hover:underline disabled:opacity-60"
          >
            Cancel
          </button>
          {error && (
            <span className="w-full text-xs text-rose-700">{error}</span>
          )}
        </div>
      )}
    </div>
  );
}

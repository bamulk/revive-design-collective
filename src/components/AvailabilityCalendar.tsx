"use client";

import { useState, useTransition } from "react";
import { Check, Loader2, RotateCcw } from "lucide-react";
import {
  setWeekdayAvailabilityAction,
  setDayOverrideAction,
  clearDayOverrideAction,
} from "@/app/(app)/availability/actions";

export type AvailabilityDay = {
  /** ISO date YYYY-MM-DD */
  date: string;
  /** 0=Sun .. 6=Sat */
  weekdayIndex: number;
  /** Weekday label, e.g. "Mon" */
  weekday: string;
  /** Day-of-month + month label, e.g. "Jun 16" */
  label: string;
  /** Week index (0-based) for grouping */
  week: number;
  /** True for Sat/Sun */
  isWeekend: boolean;
};

const WEEKDAYS = [
  { idx: 0, short: "Sun" },
  { idx: 1, short: "Mon" },
  { idx: 2, short: "Tue" },
  { idx: 3, short: "Wed" },
  { idx: 4, short: "Thu" },
  { idx: 5, short: "Fri" },
  { idx: 6, short: "Sat" },
];

/**
 * Availability picker with two layers:
 *  1. A recurring WEEKLY schedule — tap the weekdays you normally work,
 *     set once and it applies every week.
 *  2. Per-day OVERRIDES — tap a specific day to flip it on/off just for
 *     that date; a revert control clears it back to the weekly default.
 *
 * A day's shown state = override (if any) else the weekly default.
 */
export default function AvailabilityCalendar({
  days,
  initialWeekly,
  initialOverrides,
  targetStagerId,
}: {
  days: AvailabilityDay[];
  /** Weekday indices (0-6) the stager is available by default. */
  initialWeekly: number[];
  /** Per-date overrides. */
  initialOverrides: { date: string; available: boolean }[];
  /** When an admin is editing a stager's schedule, the stager's id.
      Omitted for self-editing. */
  targetStagerId?: string;
}) {
  const [weekly, setWeekly] = useState<Set<number>>(
    () => new Set(initialWeekly),
  );
  const [overrides, setOverrides] = useState<Map<string, boolean>>(
    () => new Map(initialOverrides.map((o) => [o.date, o.available])),
  );
  const [busy, setBusy] = useState<string | null>(null); // key being saved
  const [, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function effective(d: AvailabilityDay): boolean {
    if (overrides.has(d.date)) return overrides.get(d.date)!;
    return weekly.has(d.weekdayIndex);
  }

  function toggleWeekday(idx: number) {
    const wasOn = weekly.has(idx);
    const next = new Set(weekly);
    if (wasOn) next.delete(idx);
    else next.add(idx);
    setWeekly(next);
    setErr(null);
    setBusy(`w${idx}`);
    startTransition(async () => {
      const res = await setWeekdayAvailabilityAction(idx, !wasOn, targetStagerId);
      setBusy((b) => (b === `w${idx}` ? null : b));
      if (!res.ok) {
        setWeekly((cur) => {
          const rev = new Set(cur);
          if (wasOn) rev.add(idx);
          else rev.delete(idx);
          return rev;
        });
        setErr(res.error);
      }
    });
  }

  function toggleDay(d: AvailabilityDay) {
    const nextVal = !effective(d);
    const prev = new Map(overrides);
    setOverrides((cur) => new Map(cur).set(d.date, nextVal));
    setErr(null);
    setBusy(d.date);
    startTransition(async () => {
      const res = await setDayOverrideAction(d.date, nextVal, targetStagerId);
      setBusy((b) => (b === d.date ? null : b));
      if (!res.ok) {
        setOverrides(prev);
        setErr(res.error);
      }
    });
  }

  function revertDay(d: AvailabilityDay) {
    const prev = new Map(overrides);
    setOverrides((cur) => {
      const next = new Map(cur);
      next.delete(d.date);
      return next;
    });
    setErr(null);
    setBusy(d.date);
    startTransition(async () => {
      const res = await clearDayOverrideAction(d.date, targetStagerId);
      setBusy((b) => (b === d.date ? null : b));
      if (!res.ok) {
        setOverrides(prev);
        setErr(res.error);
      }
    });
  }

  const weeks = new Map<number, AvailabilityDay[]>();
  for (const d of days) {
    if (!weeks.has(d.week)) weeks.set(d.week, []);
    weeks.get(d.week)!.push(d);
  }

  return (
    <div className="space-y-6">
      {err && (
        <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">
          {err}
        </p>
      )}

      {/* Recurring weekly schedule */}
      <div className="space-y-2">
        <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Weekly schedule
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Pick the days you normally work — it repeats every week.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAYS.map((w) => {
            const on = weekly.has(w.idx);
            const saving = busy === `w${w.idx}`;
            return (
              <button
                key={w.idx}
                type="button"
                onClick={() => toggleWeekday(w.idx)}
                disabled={saving}
                aria-pressed={on}
                className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-medium transition disabled:opacity-60 ${
                  on
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                }`}
              >
                {saving ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : on ? (
                  <Check size={12} />
                ) : null}
                {w.short}
              </button>
            );
          })}
        </div>
      </div>

      {/* Per-day overrides */}
      <div className="space-y-2">
        <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Specific days
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Following your weekly schedule. Tap any day to change just that
          date; the revert arrow puts it back on schedule.
        </p>
        <div className="space-y-2">
          {[...weeks.values()].map((week, wi) => (
            <div
              key={wi}
              className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2"
            >
              {week.map((d) => {
                const on = effective(d);
                const overridden = overrides.has(d.date);
                const saving = busy === d.date;
                return (
                  <div
                    key={d.date}
                    className={`relative rounded-lg border px-3 py-2 transition ${
                      on
                        ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-700"
                        : `border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 ${
                            d.isWeekend ? "opacity-80" : ""
                          }`
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleDay(d)}
                      disabled={saving}
                      aria-pressed={on}
                      className="flex w-full flex-col items-start gap-0.5 text-left disabled:opacity-60"
                    >
                      <span className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        {d.weekday}
                      </span>
                      <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                        {d.label}
                      </span>
                      <span
                        className={`mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium ${
                          on
                            ? "text-emerald-700 dark:text-emerald-400"
                            : "text-slate-400 dark:text-slate-500"
                        }`}
                      >
                        {saving ? (
                          <Loader2 size={11} className="animate-spin" />
                        ) : on ? (
                          <Check size={11} />
                        ) : null}
                        {on ? "Available" : "Off"}
                        {overridden && (
                          <span className="text-slate-400 dark:text-slate-500">
                            · edited
                          </span>
                        )}
                      </span>
                    </button>
                    {overridden && (
                      <button
                        type="button"
                        onClick={() => revertDay(d)}
                        disabled={saving}
                        title="Revert to weekly schedule"
                        aria-label="Revert to weekly schedule"
                        className="absolute top-1.5 right-1.5 text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-300 disabled:opacity-60"
                      >
                        <RotateCcw size={13} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

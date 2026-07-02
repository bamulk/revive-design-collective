"use client";

import { useState, useTransition } from "react";
import { Loader2, ArrowRight, CheckCircle2, X } from "lucide-react";
import {
  advanceStageStatusAction,
  type AdvanceStatusResult,
} from "@/app/(app)/stages/actions";

// Button label per current status. Each maps to "Move to <label>".
// We use 'Destages' (plural, the section name) instead of 'Destaged'
// for clarity in the UI.
const NEXT_LABEL: Record<string, string | null> = {
  scheduled: "Staged",
  staged: "Destages",
  destaged: "Completed",
  completed: null,
  cancelled: null,
};

// Plain-English explanation of what advancing from the current status
// does — shown in the confirm dialog before anything is written.
const EXPLAIN: Record<string, string> = {
  scheduled:
    "This marks the home as staged (furniture in). It resets the destage date to the end of the rental period and sends a push notification to admins.",
  staged:
    "This records that the home has been destaged (furniture removed) on the date below, and sends a push notification to admins.",
  destaged:
    "This marks the job completed and moves it out of the active pipeline. It sends a push notification to admins.",
};

function todayISO(): string {
  const d = new Date();
  // Pacific-anchored — same as the rest of the app.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value || "0000";
  const m = parts.find((p) => p.type === "month")?.value || "01";
  const day = parts.find((p) => p.type === "day")?.value || "01";
  return `${y}-${m}-${day}`;
}

/**
 * Single-tap workflow advancement on the stage detail page:
 *   scheduled → staged → destages → completed.
 *
 * Every transition opens a confirm dialog that explains what the change
 * does before it's written. Going staged → destaged additionally lets
 * the user confirm the destage date (defaults to today).
 */
export default function AdvanceStatusButton({
  stageId,
  currentStatus,
}: {
  stageId: string;
  currentStatus: string;
}) {
  const nextLabel = NEXT_LABEL[currentStatus];
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<AdvanceStatusResult | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [destageDate, setDestageDate] = useState(todayISO());

  if (!nextLabel) return null;

  // Only the staged → destaged step needs a destage date picker.
  const needsDestageDate = currentStatus === "staged";
  const explanation = EXPLAIN[currentStatus] ?? "";

  function advance(extra?: { destage_date?: string | null }) {
    setResult(null);
    startTransition(async () => {
      const r = await advanceStageStatusAction(stageId, extra);
      setResult(r);
      if (r.ok) setDialogOpen(false);
    });
  }

  function onConfirm() {
    if (needsDestageDate) advance({ destage_date: destageDate });
    else advance();
  }

  // Pick a tint that hints at the next state.
  const palette: Record<string, string> = {
    scheduled: "bg-amber-600 hover:bg-amber-700", // → Staged
    staged: "bg-violet-600 hover:bg-violet-700", // → Destages
    destaged: "bg-emerald-600 hover:bg-emerald-700", // → Completed
  };
  const tint = palette[currentStatus] || "bg-slate-900 hover:bg-slate-800";

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => {
          setResult(null);
          setDialogOpen(true);
        }}
        disabled={pending}
        className={`inline-flex items-center gap-1.5 text-white text-sm rounded-lg px-3 py-2 disabled:opacity-60 ${tint}`}
      >
        {nextLabel === "Completed" ? (
          <CheckCircle2 size={14} />
        ) : (
          <ArrowRight size={14} />
        )}
        Move to {nextLabel}
      </button>

      {result && !result.ok && !dialogOpen && (
        <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">
          {result.error}
        </p>
      )}

      {/* Confirm dialog — explains the change (and collects the destage
          date when moving to Destages). */}
      {dialogOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50"
          onClick={() => !pending && setDialogOpen(false)}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-xl shadow-xl w-full max-w-sm p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <h2 className="font-semibold text-slate-900 dark:text-slate-100">
                Move to {nextLabel}?
              </h2>
              <button
                type="button"
                aria-label="Cancel"
                onClick={() => !pending && setDialogOpen(false)}
                disabled={pending}
                className="text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-300 disabled:opacity-50"
              >
                <X size={18} />
              </button>
            </div>

            {explanation && (
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {explanation}
              </p>
            )}

            {needsDestageDate && (
              <label className="block text-sm">
                Destage date
                <input
                  type="date"
                  value={destageDate}
                  onChange={(e) => setDestageDate(e.target.value)}
                  disabled={pending}
                  className="mt-1 w-full border rounded px-3 py-2.5 text-base"
                />
              </label>
            )}

            {result && !result.ok && (
              <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">
                {result.error}
              </p>
            )}

            <div className="flex gap-2 justify-end pt-1">
              <button
                type="button"
                onClick={() => setDialogOpen(false)}
                disabled={pending}
                className="text-sm px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={pending || (needsDestageDate && !destageDate)}
                className={`inline-flex items-center gap-1.5 text-white text-sm rounded-lg px-3 py-2 disabled:opacity-60 ${tint}`}
              >
                {pending ? (
                  <>
                    <Loader2 size={14} className="animate-spin" /> Moving…
                  </>
                ) : (
                  <>
                    {nextLabel === "Completed" ? (
                      <CheckCircle2 size={14} />
                    ) : (
                      <ArrowRight size={14} />
                    )}
                    Move to {nextLabel}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { Check, Loader2 } from "lucide-react";
import { markExtensionPaidAction } from "@/app/(app)/stages/actions";

/**
 * Inline "Mark as paid" for the dashboard's Outstanding extensions
 * rows. Reuses markExtensionPaidAction — the same action the stage
 * page's Extensions panel uses (stamps the extension's paid_at and
 * mirrors it onto the stage rollup). Two-step so a stray tap on a
 * dashboard list can't mark money paid by accident.
 */
export default function QuickMarkExtensionPaid({
  extensionId,
  stageId,
}: {
  extensionId: string;
  stageId: string;
}) {
  const [armed, setArmed] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function confirm() {
    setError(null);
    startTransition(async () => {
      const r = await markExtensionPaidAction(extensionId, stageId);
      // On success the dashboard revalidates and the row disappears.
      if (!r.ok) {
        setError(r.error);
        setArmed(false);
      }
    });
  }

  if (!armed) {
    return (
      <span className="inline-flex flex-col items-end gap-0.5">
        <button
          type="button"
          onClick={() => {
            setError(null);
            setArmed(true);
          }}
          className="inline-flex items-center gap-1 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded px-2 py-1"
        >
          <Check size={12} /> Mark as paid
        </button>
        {error && (
          <span className="text-[11px] text-rose-700 max-w-[14rem] text-right leading-tight">
            {error}
          </span>
        )}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 ring-1 ring-emerald-200 dark:ring-emerald-900/50 px-1 py-0.5">
      <span className="text-[11px] text-emerald-800 dark:text-emerald-200 pl-1.5">
        Paid?
      </span>
      <button
        type="button"
        onClick={() => setArmed(false)}
        disabled={pending}
        className="text-[11px] font-medium text-slate-700 dark:text-slate-300 px-2 py-0.5 rounded-full hover:bg-emerald-100 dark:hover:bg-emerald-900/40 disabled:opacity-60"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={confirm}
        disabled={pending}
        className="inline-flex items-center gap-1 text-[11px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 px-2 py-0.5 rounded-full disabled:opacity-60"
      >
        {pending ? (
          <>
            <Loader2 size={11} className="animate-spin" /> Saving…
          </>
        ) : (
          <>
            <Check size={11} /> Confirm
          </>
        )}
      </button>
    </span>
  );
}

"use client";

import { useState, useTransition } from "react";
import { Loader2, ChevronDown, X } from "lucide-react";
import { updateStageStatusAction } from "@/app/(app)/stages/actions";

// Mirrors the workflow statuses. 'destaged' shows as 'Destages' to
// match the label used everywhere else in the app.
const STATUSES: { key: string; label: string }[] = [
  { key: "scheduled", label: "Scheduled" },
  { key: "staged", label: "Staged" },
  { key: "destaged", label: "Destages" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
];

// Plain-English meaning of each status, shown in the confirm prompt.
const MEANING: Record<string, string> = {
  scheduled: "Back to Upcoming — the home isn't staged yet.",
  staged: "The home is currently staged (furniture in, awaiting destage).",
  destaged: "The furniture has been removed.",
  completed: "The job is finished and out of the active pipeline.",
  cancelled: "This stage is cancelled.",
};

function labelFor(key: string) {
  return STATUSES.find((s) => s.key === key)?.label ?? key;
}

/**
 * "Change status" control for the stage detail page. Unlike the forward
 * AdvanceStatusButton, this lets any team member set the status to ANY
 * value — the way to undo an accidental move (e.g. bumped a stage to
 * Destages by mistake and need it back to Staged). It uses
 * updateStageStatusAction, which has no side effects (no destage-date
 * reset, no notification), so it's safe for corrections.
 *
 * Picking a status opens a confirm prompt explaining what the change
 * means before anything is written.
 */
export default function StatusControl({
  stageId,
  currentStatus,
}: {
  stageId: string;
  currentStatus: string;
}) {
  const [open, setOpen] = useState(false);
  // The status the user picked and now needs to confirm.
  const [confirmStatus, setConfirmStatus] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function pick(status: string) {
    setOpen(false);
    if (status === currentStatus) return;
    setError(null);
    setConfirmStatus(status);
  }

  function confirm() {
    if (!confirmStatus) return;
    setError(null);
    startTransition(async () => {
      try {
        await updateStageStatusAction(stageId, confirmStatus, "status_select");
        setConfirmStatus(null);
      } catch (e: any) {
        setError(e?.message || "Couldn't change the status.");
      }
    });
  }

  return (
    <div className="relative inline-block text-left">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={pending}
        className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 disabled:opacity-60"
      >
        <ChevronDown size={12} />
        Change status
      </button>

      {open && (
        <>
          {/* Click-away backdrop so the menu never gets stuck open. */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-20 mt-1 w-44 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg p-1">
            {STATUSES.map((s) => {
              const isCurrent = s.key === currentStatus;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => pick(s.key)}
                  disabled={isCurrent}
                  className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm text-left ${
                    isCurrent
                      ? "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 cursor-default"
                      : "hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200"
                  }`}
                >
                  {s.label}
                  {isCurrent && (
                    <span className="text-[10px] uppercase tracking-wide">
                      current
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* Confirm prompt — explains the change before it's written. */}
      {confirmStatus && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50"
          onClick={() => !pending && setConfirmStatus(null)}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-xl shadow-xl w-full max-w-sm p-5 space-y-4 text-left"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <h2 className="font-semibold text-slate-900 dark:text-slate-100">
                Change status to {labelFor(confirmStatus)}?
              </h2>
              <button
                type="button"
                aria-label="Cancel"
                onClick={() => !pending && setConfirmStatus(null)}
                disabled={pending}
                className="text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-300 disabled:opacity-50"
              >
                <X size={18} />
              </button>
            </div>

            <div className="text-sm text-slate-600 dark:text-slate-300 space-y-2">
              <p>{MEANING[confirmStatus] ?? "Sets this stage's status."}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                This is a manual change to correct the status. It won't change
                any dates or send notifications.
              </p>
            </div>

            {error && (
              <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">
                {error}
              </p>
            )}

            <div className="flex gap-2 justify-end pt-1">
              <button
                type="button"
                onClick={() => setConfirmStatus(null)}
                disabled={pending}
                className="text-sm px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirm}
                disabled={pending}
                className="inline-flex items-center gap-1.5 bg-slate-900 text-white rounded-lg px-3 py-2 text-sm disabled:opacity-60 dark:bg-white dark:text-slate-900"
              >
                {pending ? (
                  <>
                    <Loader2 size={14} className="animate-spin" /> Saving…
                  </>
                ) : (
                  <>Set to {labelFor(confirmStatus)}</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {error && !confirmStatus && (
        <p className="mt-1 text-xs text-rose-700">{error}</p>
      )}
    </div>
  );
}

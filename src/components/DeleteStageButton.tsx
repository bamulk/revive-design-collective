"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { deleteStageAction } from "@/app/(app)/stages/actions";

/**
 * Two-step delete button for the stage detail page (admin only).
 *
 * First click swaps the button for a "Cancel | Confirm" pair so the
 * user has to deliberately click twice. We avoided window.confirm()
 * because it blocks the main thread for as long as the user takes to
 * read it, which Chrome flags as a >1.5 s INP issue.
 *
 * The server action redirects on success — that throws a NEXT_REDIRECT
 * error which we must re-throw so Next can perform the navigation.
 */
export default function DeleteStageButton({
  stageId,
  label,
}: {
  stageId: string;
  /** Optional human label for the confirm prompt (e.g. the address). */
  label?: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Click outside to dismiss the "Are you sure?" state.
  useEffect(() => {
    if (!confirming) return;
    function onDocClick(e: MouseEvent) {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setConfirming(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [confirming]);

  function fire() {
    startTransition(async () => {
      try {
        await deleteStageAction(stageId);
      } catch (e: any) {
        if (
          e?.digest?.startsWith?.("NEXT_REDIRECT") ||
          e?.message === "NEXT_REDIRECT"
        ) {
          throw e;
        }
        alert(e?.message || "Delete failed");
        setConfirming(false);
      }
    });
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={pending}
        className="shrink-0 inline-flex items-center gap-1.5 bg-white dark:bg-slate-900 border border-rose-200 text-rose-700 hover:bg-rose-50 rounded-lg px-3 py-2 text-sm disabled:opacity-60"
      >
        <Trash2 size={14} /> Delete
      </button>
    );
  }

  const target = label ? `"${label}"` : "this stage";
  return (
    <div
      ref={wrapperRef}
      className="shrink-0 inline-flex items-center gap-2 rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 px-2 py-1.5 text-sm"
    >
      <span className="text-rose-800 dark:text-rose-200 truncate max-w-[14rem]">
        Delete {target}?
      </span>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        disabled={pending}
        className="px-2 py-1 rounded-md text-rose-800 dark:text-rose-200 hover:bg-rose-100 dark:hover:bg-rose-900/50 disabled:opacity-60"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={fire}
        disabled={pending}
        autoFocus
        className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-rose-700 hover:bg-rose-800 text-white disabled:opacity-60"
      >
        {pending ? (
          <>
            <Loader2 size={12} className="animate-spin" /> Deleting…
          </>
        ) : (
          <>
            <Trash2 size={12} /> Delete
          </>
        )}
      </button>
    </div>
  );
}

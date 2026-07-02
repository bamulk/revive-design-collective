"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, X } from "lucide-react";

/**
 * Edit / Cancel navigation buttons on the stage detail page. Wrapped
 * in useTransition so the user sees a spinner the instant they tap —
 * no more "did anything happen?" pause while the server re-renders the
 * route with ?edit=1.
 *
 * We also call router.prefetch on mount so Next caches the loading
 * fallback + any cacheable RSC payload before the click, shortening
 * the actual server round-trip after click.
 */
export function StageEditLink({ stageId }: { stageId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const href = `/stages/${stageId}?edit=1`;
  useEffect(() => {
    router.prefetch(href);
  }, [router, href]);
  return (
    <button
      type="button"
      onClick={() =>
        startTransition(() => router.push(href, { scroll: false }))
      }
      disabled={pending}
      className="inline-flex items-center gap-1.5 bg-slate-900 text-white rounded-lg px-3 py-2 text-sm hover:bg-slate-800 disabled:opacity-80 disabled:cursor-progress"
    >
      {pending ? (
        <Loader2 size={14} className="animate-spin" />
      ) : (
        <Pencil size={14} />
      )}
      {pending ? "Opening…" : "Edit"}
    </button>
  );
}

/**
 * Cancel button shown inside the edit form. Same pending pattern so
 * tapping it feels instant. Lives in the same file as StageEditLink
 * because both prefetch a stage URL on mount.
 */
export function StageCancelEditLink({ stageId }: { stageId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const href = `/stages/${stageId}`;
  useEffect(() => {
    router.prefetch(href);
  }, [router, href]);
  return (
    <button
      type="button"
      onClick={() =>
        startTransition(() => router.push(href, { scroll: false }))
      }
      disabled={pending}
      className="text-sm text-slate-700 dark:text-slate-300 rounded-lg px-4 py-2.5 border border-slate-200 dark:border-slate-700 text-center hover:bg-slate-50 dark:hover:bg-slate-900 disabled:opacity-70 disabled:cursor-progress inline-flex items-center justify-center gap-2"
    >
      {pending ? (
        <>
          <Loader2 size={14} className="animate-spin" /> Closing…
        </>
      ) : (
        <>
          <X size={14} /> Cancel
        </>
      )}
    </button>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MapPinned } from "lucide-react";
import { bulkGeocodeStagesAction } from "./actions";

/**
 * Admin-only button that geocodes the next batch of ungeocoded
 * stages. Nominatim's rate limit means each click handles up to ~30
 * addresses (~30s of API calls). The button shows the result and
 * stays available so admins can re-click to drain the backlog.
 */
export default function BulkGeocodeButton({ remaining }: { remaining: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  function onClick() {
    setResult(null);
    startTransition(async () => {
      try {
        const { processed, found } = await bulkGeocodeStagesAction();
        if (processed === 0) {
          setResult("All caught up.");
        } else {
          setResult(`Geocoded ${found} of ${processed}. ${remaining - found} left.`);
        }
        router.refresh();
      } catch (err: any) {
        setResult(`Error: ${err?.message || "geocode failed"}`);
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-900 disabled:opacity-60"
      >
        {pending ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <MapPinned size={14} />
        )}
        {pending ? "Geocoding…" : `Geocode (${remaining})`}
      </button>
      {result && <span className="text-[11px] text-slate-500 dark:text-slate-400">{result}</span>}
    </div>
  );
}

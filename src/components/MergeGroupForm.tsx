"use client";

import { useState, useTransition } from "react";
import { mergeClientsAction } from "@/app/(app)/clients/actions";
import { Loader2, ArrowRight } from "lucide-react";

type ClientRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  stageCount: number;
};

/**
 * One group of likely-duplicate clients. The user picks which one to keep;
 * everyone else in the group gets merged into it on submit.
 */
export default function MergeGroupForm({
  clients,
  defaultKeepId,
}: {
  clients: ClientRow[];
  defaultKeepId: string;
}) {
  const [keepId, setKeepId] = useState(defaultKeepId);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const losers = clients.filter((c) => c.id !== keepId);

  function onMerge() {
    setError(null);
    startTransition(async () => {
      try {
        await mergeClientsAction(
          keepId,
          losers.map((l) => l.id)
        );
      } catch (e: any) {
        setError(e.message || "Merge failed");
      }
    });
  }

  return (
    <div className="border rounded-xl bg-white dark:bg-slate-900 p-4 space-y-3">
      <div className="space-y-2">
        {clients.map((c) => (
          <label
            key={c.id}
            className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg cursor-pointer border transition ${
              c.id === keepId
                ? "bg-emerald-50 border-emerald-200"
                : "bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <input
                type="radio"
                name={`keep-${clients[0].id}`}
                checked={c.id === keepId}
                onChange={() => setKeepId(c.id)}
                className="accent-emerald-600"
              />
              <div className="min-w-0">
                <div className="font-medium text-slate-900 dark:text-slate-100 truncate">
                  {c.name}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                  {c.email || "no email"} · {c.phone || "no phone"}
                </div>
              </div>
            </div>
            <div className="text-xs text-slate-600 dark:text-slate-400 shrink-0">
              {c.stageCount} stage{c.stageCount === 1 ? "" : "s"}
            </div>
          </label>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3 pt-2 border-t">
        <p className="text-xs text-slate-600 dark:text-slate-400">
          {losers.length === 0 ? (
            "Pick which client to keep."
          ) : (
            <>
              Merge {losers.length} into{" "}
              <span className="font-medium text-slate-900 dark:text-slate-100">
                {clients.find((c) => c.id === keepId)?.name}
              </span>
            </>
          )}
        </p>
        <button
          type="button"
          onClick={onMerge}
          disabled={pending || losers.length === 0}
          className="inline-flex items-center gap-1.5 bg-slate-900 disabled:bg-slate-300 text-white text-sm rounded-lg px-3 py-2"
        >
          {pending ? (
            <>
              <Loader2 size={14} className="animate-spin" /> Merging…
            </>
          ) : (
            <>
              Merge <ArrowRight size={14} />
            </>
          )}
        </button>
      </div>

      {error && (
        <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded p-2">
          {error}
        </p>
      )}
    </div>
  );
}

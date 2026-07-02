"use client";

import { useMemo, useState, useTransition } from "react";
import { mergeClientsAction } from "@/app/(app)/clients/actions";
import { Loader2, ArrowRight, Search } from "lucide-react";

type Option = { id: string; name: string; stageCount: number };

/**
 * Manual two-client merge for cases the auto-detector misses (different
 * names spelling the same person, alias swaps, etc.). Each side is a
 * searchable picker over every client.
 */
export default function ManualMergeForm({ options }: { options: Option[] }) {
  const [keepId, setKeepId] = useState<string>("");
  const [loserId, setLoserId] = useState<string>("");
  const [keepQ, setKeepQ] = useState("");
  const [loserQ, setLoserQ] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const keepResults = useFilter(options, keepQ, keepId, loserId);
  const loserResults = useFilter(options, loserQ, loserId, keepId);

  function onMerge() {
    setError(null);
    if (!keepId || !loserId) {
      setError("Pick both clients");
      return;
    }
    if (keepId === loserId) {
      setError("Pick two different clients");
      return;
    }
    startTransition(async () => {
      try {
        await mergeClientsAction(keepId, [loserId]);
        setLoserId("");
        setLoserQ("");
      } catch (e: any) {
        setError(e.message || "Merge failed");
      }
    });
  }

  return (
    <div className="border rounded-xl bg-white dark:bg-slate-900 p-4 space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Picker
          label="Keep this client"
          tone="emerald"
          query={keepQ}
          setQuery={setKeepQ}
          selectedId={keepId}
          setSelectedId={setKeepId}
          results={keepResults}
          options={options}
        />
        <Picker
          label="Merge in (gets deleted)"
          tone="rose"
          query={loserQ}
          setQuery={setLoserQ}
          selectedId={loserId}
          setSelectedId={setLoserId}
          results={loserResults}
          options={options}
        />
      </div>

      <div className="flex items-center justify-end gap-3">
        {error && (
          <p className="text-xs text-rose-600">{error}</p>
        )}
        <button
          type="button"
          onClick={onMerge}
          disabled={pending || !keepId || !loserId}
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
    </div>
  );
}

function Picker({
  label,
  tone,
  query,
  setQuery,
  selectedId,
  setSelectedId,
  results,
  options,
}: {
  label: string;
  tone: "emerald" | "rose";
  query: string;
  setQuery: (s: string) => void;
  selectedId: string;
  setSelectedId: (id: string) => void;
  results: Option[];
  options: Option[];
}) {
  const selected = options.find((o) => o.id === selectedId);
  const toneClass =
    tone === "emerald"
      ? "border-emerald-200 bg-emerald-50"
      : "border-rose-200 bg-rose-50";

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400">
        {label}
      </div>
      {selected ? (
        <div
          className={`flex items-center justify-between px-3 py-2 rounded-lg border ${toneClass}`}
        >
          <div>
            <div className="font-medium text-slate-900 dark:text-slate-100">{selected.name}</div>
            <div className="text-xs text-slate-600 dark:text-slate-400">
              {selected.stageCount} stage{selected.stageCount === 1 ? "" : "s"}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSelectedId("")}
            className="text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:text-slate-100"
          >
            Change
          </button>
        </div>
      ) : (
        <>
          <div className="relative">
            <Search
              size={14}
              className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search clients…"
              className="w-full border rounded-lg pl-7 pr-3 py-2 text-sm"
            />
          </div>
          {query && (
            <div className="max-h-48 overflow-y-auto border rounded-lg divide-y">
              {results.slice(0, 12).map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(r.id);
                    setQuery("");
                  }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-900 flex items-center justify-between"
                >
                  <span className="font-medium text-slate-900 dark:text-slate-100">{r.name}</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {r.stageCount}
                  </span>
                </button>
              ))}
              {results.length === 0 && (
                <div className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400">
                  No matches
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function useFilter(
  options: Option[],
  query: string,
  selectedId: string,
  otherId: string
) {
  return useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return options
      .filter((o) => o.id !== selectedId && o.id !== otherId)
      .filter((o) => o.name.toLowerCase().includes(q))
      .sort((a, b) => b.stageCount - a.stageCount);
  }, [options, query, selectedId, otherId]);
}

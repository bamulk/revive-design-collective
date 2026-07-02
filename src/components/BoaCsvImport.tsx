"use client";

import { useState, useTransition } from "react";
import { Loader2, Upload, Check } from "lucide-react";
import {
  importBoaCsvAction,
  type ImportResult,
} from "@/app/(app)/finance/actions";
import { useRouter } from "next/navigation";

export default function BoaCsvImport() {
  const [csv, setCsv] = useState("");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ImportResult | null>(null);
  const router = useRouter();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);
    startTransition(async () => {
      const r = await importBoaCsvAction(csv);
      setResult(r);
      if (r.ok && r.inserted > 0) {
        // Bounce back to the dashboard so the user sees the updated bars.
        setTimeout(() => router.push("/finance"), 1500);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <label className="block text-sm font-medium text-slate-900 dark:text-slate-100">
        Paste CSV
      </label>
      <textarea
        value={csv}
        onChange={(e) => setCsv(e.target.value)}
        rows={14}
        spellCheck={false}
        placeholder='Date,Description,Amount,Running Bal.&#10;"01/04/2026","HOME DEPOT",-123.45,"1,234.56"&#10;...'
        className="w-full border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-xs font-mono"
      />
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {csv.length > 0
            ? `${csv.length.toLocaleString()} characters pasted`
            : "Paste from your BoA CSV export above"}
        </p>
        <button
          type="submit"
          disabled={pending || csv.length < 20}
          className="inline-flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white rounded-lg px-4 py-2 text-sm"
        >
          {pending ? (
            <>
              <Loader2 size={14} className="animate-spin" /> Importing…
            </>
          ) : (
            <>
              <Upload size={14} /> Import
            </>
          )}
        </button>
      </div>

      {result?.ok && (
        <div className="text-sm bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg p-3 space-y-1">
          <div className="inline-flex items-center gap-1.5 font-medium">
            <Check size={14} /> Imported {result.inserted} expense
            {result.inserted === 1 ? "" : "s"}.
          </div>
          {result.duplicates > 0 && (
            <div>
              Skipped {result.duplicates} duplicate row
              {result.duplicates === 1 ? "" : "s"} (already on file).
            </div>
          )}
          {result.creditsSkipped > 0 && (
            <div>
              Skipped {result.creditsSkipped} credit/deposit row
              {result.creditsSkipped === 1 ? "" : "s"} (income comes from
              paid stages).
            </div>
          )}
          {result.unparseableSkipped > 0 && (
            <div className="text-emerald-700/80 text-xs">
              {result.unparseableSkipped} row
              {result.unparseableSkipped === 1 ? "" : "s"} couldn&apos;t be
              parsed (likely BoA summary lines).
            </div>
          )}
          {result.inserted > 0 && (
            <div className="text-xs text-emerald-700/80">
              Bouncing you back to the dashboard…
            </div>
          )}
        </div>
      )}
      {result && !result.ok && (
        <p className="text-sm bg-rose-50 border border-rose-200 text-rose-700 rounded-lg p-3">
          {result.error}
        </p>
      )}
    </form>
  );
}

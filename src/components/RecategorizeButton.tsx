"use client";

import { useState, useTransition } from "react";
import { Loader2, Tag } from "lucide-react";
import {
  recategorizeAllExpensesAction,
  type RecategorizeResult,
} from "@/app/(app)/finance/actions";

/**
 * Runs categorizeExpense() over every existing expense row. Useful
 * after editing the rule set in lib/expense-categorize.ts or as a
 * one-time backfill for rows imported before the rules existed.
 */
export default function RecategorizeButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<RecategorizeResult | null>(null);

  function onClick() {
    setResult(null);
    startTransition(async () => {
      const r = await recategorizeAllExpensesAction();
      setResult(r);
    });
  }
  return (
    <div className="inline-flex items-start gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="inline-flex items-center gap-1.5 text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-900 disabled:opacity-60"
      >
        {pending ? (
          <>
            <Loader2 size={14} className="animate-spin" /> Recategorizing…
          </>
        ) : (
          <>
            <Tag size={14} /> Recategorize all
          </>
        )}
      </button>
      {result?.ok && (
        <span
          className="text-xs text-emerald-700 dark:text-emerald-300 mt-2 max-w-[18rem]"
          title="A recategorize pass walks every expense and only writes rows whose category would change. Zero updates means every row already matches the current rules."
        >
          {result.updated === 0
            ? `Already up to date — ${result.total} checked, nothing to change.`
            : `Updated ${result.updated} of ${result.total}.`}
        </span>
      )}
      {result && !result.ok && (
        <span className="text-xs text-rose-700 dark:text-rose-300 mt-2">
          {result.error}
        </span>
      )}
    </div>
  );
}

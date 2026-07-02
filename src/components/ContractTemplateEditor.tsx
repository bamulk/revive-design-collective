"use client";

import { useState, useTransition } from "react";
import { Loader2, Plus, Trash2, ArrowUp, ArrowDown, Check } from "lucide-react";
import {
  updateContractTemplateAction,
  type UpdateContractTemplateResult,
} from "@/app/(app)/admin/contract/actions";
import type { ContractTerm } from "@/lib/contract-template";

export default function ContractTemplateEditor({
  initial,
}: {
  initial: {
    company_name: string;
    intro: string | null;
    terms: ContractTerm[];
  };
}) {
  const [companyName, setCompanyName] = useState(initial.company_name);
  const [intro, setIntro] = useState(initial.intro ?? "");
  const [terms, setTerms] = useState<ContractTerm[]>(initial.terms);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<UpdateContractTemplateResult | null>(
    null
  );

  function update(idx: number, patch: Partial<ContractTerm>) {
    setTerms((prev) =>
      prev.map((t, i) => (i === idx ? { ...t, ...patch } : t))
    );
  }
  function add() {
    setTerms((prev) => [...prev, { title: "", body: "" }]);
  }
  function remove(idx: number) {
    setTerms((prev) => prev.filter((_, i) => i !== idx));
  }
  function move(idx: number, dir: -1 | 1) {
    setTerms((prev) => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }

  function onSave(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);
    startTransition(async () => {
      const r = await updateContractTemplateAction({
        company_name: companyName,
        intro: intro || null,
        terms,
      });
      setResult(r);
    });
  }

  return (
    <form onSubmit={onSave} className="space-y-6">
      <div className="bg-white dark:bg-slate-900 border rounded-xl p-5 space-y-4">
        <label className="block text-sm">
          Company name
          <input
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            required
            className="mt-1 w-full border rounded px-3 py-2.5 text-base"
          />
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Appears in the agreement header and as the &quot;Stager&quot; party.
          </p>
        </label>

        <label className="block text-sm">
          Intro paragraph (optional)
          <textarea
            value={intro}
            onChange={(e) => setIntro(e.target.value)}
            rows={3}
            placeholder="Leave blank to skip. Shown above the Parties section."
            className="mt-1 w-full border rounded px-3 py-2.5 text-base"
          />
        </label>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">Terms</h2>
          <button
            type="button"
            onClick={add}
            className="inline-flex items-center gap-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-900"
          >
            <Plus size={14} /> Add term
          </button>
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-400">
          Each term gets numbered automatically in the contract. Drag-reorder
          via the up/down arrows.
        </p>

        <div className="space-y-3">
          {terms.map((t, i) => (
            <div
              key={i}
              className="bg-white dark:bg-slate-900 border rounded-xl p-4 space-y-2"
            >
              <div className="flex items-start gap-2">
                <span className="text-xs font-mono text-slate-400 dark:text-slate-500 pt-2 w-6 text-right">
                  {i + 1}.
                </span>
                <div className="flex-1 space-y-2">
                  <input
                    value={t.title}
                    onChange={(e) => update(i, { title: e.target.value })}
                    placeholder="Term title (e.g. Cancellation)"
                    className="w-full border rounded px-3 py-2 text-base font-medium"
                  />
                  <textarea
                    value={t.body}
                    onChange={(e) => update(i, { body: e.target.value })}
                    placeholder="Term details…"
                    rows={3}
                    className="w-full border rounded px-3 py-2 text-base"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    aria-label="Move up"
                    className="w-8 h-8 inline-flex items-center justify-center rounded text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent"
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(i, 1)}
                    disabled={i === terms.length - 1}
                    aria-label="Move down"
                    className="w-8 h-8 inline-flex items-center justify-center rounded text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent"
                  >
                    <ArrowDown size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    aria-label="Delete term"
                    className="w-8 h-8 inline-flex items-center justify-center rounded text-rose-500 hover:bg-rose-50"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
          {terms.length === 0 && (
            <p className="text-sm text-slate-500 dark:text-slate-400 italic">
              No terms yet — click &quot;Add term&quot; to start.
            </p>
          )}
        </div>
      </div>

      <div className="sticky bottom-0 -mx-4 sm:mx-0 bg-white dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-700/70 p-4 flex items-center justify-end gap-3">
        {result?.ok && (
          <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700">
            <Check size={12} /> Saved
          </span>
        )}
        {result && !result.ok && (
          <span className="text-xs text-rose-700">{result.error}</span>
        )}
        <button
          type="submit"
          disabled={pending}
          className="bg-brand hover:bg-brand-hover disabled:opacity-60 text-white rounded-lg px-4 py-2 text-sm inline-flex items-center gap-2"
        >
          {pending ? (
            <>
              <Loader2 size={14} className="animate-spin" /> Saving…
            </>
          ) : (
            <>Save template</>
          )}
        </button>
      </div>
    </form>
  );
}

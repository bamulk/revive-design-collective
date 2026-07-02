"use client";

import { useState, useTransition } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { recordManualExtensionAction } from "@/app/(app)/stages/actions";
import { todayPacificISO } from "@/lib/time";

/**
 * Admin-only "Record extension" form on the stage detail page. Used
 * for back-filling past extensions the client paid on a handshake
 * (i.e. didn't go through the /x/{token} reminder flow).
 *
 * Bumps the stage's extension_count, sets extension_invoice_amount,
 * optionally pushes destage_date forward, and optionally stamps a
 * paid date. No PDF is generated — this is bookkeeping.
 */
export default function ManualExtensionForm({
  stageId,
  defaultAmount,
  defaultNewDestageDate,
}: {
  stageId: string;
  /** Pre-fill the amount input. Typically 50% of the original stage amount. */
  defaultAmount: number;
  /** Pre-fill the new destage_date — usually current destage + 30 days. */
  defaultNewDestageDate: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState<string>(
    defaultAmount > 0 ? defaultAmount.toFixed(2) : "",
  );
  const [newDestageDate, setNewDestageDate] = useState<string>(
    defaultNewDestageDate ?? "",
  );
  const [moveDestage, setMoveDestage] = useState<boolean>(true);
  const [paid, setPaid] = useState<boolean>(false);
  const [paidAt, setPaidAt] = useState<string>(todayPacificISO());
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      setError("Enter an amount greater than 0.");
      return;
    }
    startTransition(async () => {
      const res = await recordManualExtensionAction(stageId, {
        amount: n,
        newDestageDate: moveDestage ? newDestageDate || null : null,
        paid,
        paidAt: paid ? paidAt || null : null,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800"
      >
        <Plus size={12} /> Record extension
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="border border-slate-200 dark:border-slate-700 rounded-lg p-3 space-y-3 bg-slate-50 dark:bg-slate-900/60"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-slate-900 dark:text-slate-100">
          Record extension
        </h3>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Cancel"
          className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
        >
          <X size={14} />
        </button>
      </div>

      <label className="block text-xs">
        Extension amount
        <div className="relative mt-1 max-w-[160px]">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 text-sm">
            $
          </span>
          <input
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="w-full border rounded pl-6 pr-2 py-2 text-sm"
            required
          />
        </div>
      </label>

      <label className="flex items-start gap-2 text-xs cursor-pointer">
        <input
          type="checkbox"
          checked={moveDestage}
          onChange={(e) => setMoveDestage(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-brand"
        />
        <span>
          Push destage date forward
          <span className="block text-[11px] text-slate-500 dark:text-slate-400">
            Skip this for already-destaged stages — the date stays as
            originally recorded.
          </span>
        </span>
      </label>
      {moveDestage && (
        <label className="block text-xs">
          New destage date
          <input
            type="date"
            value={newDestageDate}
            onChange={(e) => setNewDestageDate(e.target.value)}
            className="mt-1 w-full max-w-[200px] border rounded px-2 py-2 text-sm"
          />
        </label>
      )}

      <label className="flex items-start gap-2 text-xs cursor-pointer">
        <input
          type="checkbox"
          checked={paid}
          onChange={(e) => setPaid(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-brand"
        />
        <span>Mark extension paid</span>
      </label>
      {paid && (
        <label className="block text-xs">
          Paid on
          <input
            type="date"
            value={paidAt}
            onChange={(e) => setPaidAt(e.target.value)}
            className="mt-1 w-full max-w-[200px] border rounded px-2 py-2 text-sm"
          />
        </label>
      )}

      {error && (
        <p className="text-xs text-rose-700 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 rounded p-2">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-60"
        >
          {pending && <Loader2 size={12} className="animate-spin" />}
          Save extension
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={pending}
          className="text-xs px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

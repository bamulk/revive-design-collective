"use client";

import { useMemo, useState, useTransition } from "react";
import { Trash2, Plus, CheckCircle2, Loader2 } from "lucide-react";
import { formatMDY } from "@/lib/time";
import {
  recordStagePaymentAction,
  deleteStagePaymentAction,
} from "@/app/(app)/stages/actions";

export type StagePaymentRow = {
  id: string;
  amount: number;
  paid_at: string;
  method: string | null;
  note: string | null;
  created_at: string;
};

const METHODS = ["check", "cash", "zelle", "card", "other"] as const;
type Method = (typeof METHODS)[number];

function fmtMoney(n: number) {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

/**
 * Admin-only payments ledger card. Shows the invoice total, the
 * running paid-so-far, and the outstanding balance, followed by a
 * record-payment form and the list of payments to date. Each payment
 * row has an inline two-step delete.
 *
 * The card auto-hides "Record payment" when the stage is fully paid
 * and shows a clean "Paid in full" state instead.
 */
export default function PaymentsSection({
  stageId,
  stageAmount,
  payments,
}: {
  stageId: string;
  stageAmount: number;
  payments: StagePaymentRow[];
}) {
  const total = useMemo(
    () =>
      payments.reduce((sum, p) => sum + Number(p.amount || 0), 0),
    [payments],
  );
  const outstanding = Math.max(stageAmount - total, 0);
  const isPaidInFull = stageAmount > 0 && outstanding <= 0;

  return (
    <section className="bg-white dark:bg-slate-900 border rounded-xl p-5 space-y-4">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="text-base font-semibold tracking-tight">Payments</h2>
        {isPaidInFull && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 size={12} /> Paid in full
          </span>
        )}
      </div>

      {/* Money summary */}
      <div className="grid grid-cols-3 gap-3 text-sm">
        <SumCell label="Invoice">{fmtMoney(stageAmount)}</SumCell>
        <SumCell label="Paid so far" tone="text-emerald-700">
          {fmtMoney(total)}
        </SumCell>
        <SumCell
          label="Outstanding"
          tone={outstanding > 0 ? "text-rose-700" : "text-slate-500"}
        >
          {fmtMoney(outstanding)}
        </SumCell>
      </div>

      {!isPaidInFull && stageAmount > 0 && (
        <RecordPaymentForm stageId={stageId} defaultAmount={outstanding} />
      )}

      {payments.length > 0 ? (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800 border-t border-slate-100 dark:border-slate-800">
          {payments.map((p) => (
            <PaymentRow key={p.id} stageId={stageId} p={p} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-500 dark:text-slate-400 border-t border-slate-100 dark:border-slate-800 pt-3">
          No payments yet.
        </p>
      )}
    </section>
  );
}

function SumCell({
  label,
  tone,
  children,
}: {
  label: string;
  tone?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg bg-slate-50 dark:bg-slate-800/50 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div
        className={`text-base font-semibold tabular-nums ${tone ?? "text-slate-900 dark:text-slate-100"}`}
      >
        {children}
      </div>
    </div>
  );
}

function RecordPaymentForm({
  stageId,
  defaultAmount,
}: {
  stageId: string;
  defaultAmount: number;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [today] = useState(() => new Date().toISOString().slice(0, 10));

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const form = e.currentTarget;
    startTransition(async () => {
      const res = await recordStagePaymentAction(stageId, fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      form.reset();
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-start pt-1"
    >
      <input
        name="amount"
        type="number"
        step="0.01"
        min="0.01"
        defaultValue={defaultAmount.toFixed(2)}
        required
        className="sm:col-span-3 border border-slate-300 dark:border-slate-700 rounded px-3 py-2 text-sm bg-white dark:bg-slate-900 tabular-nums"
        placeholder="Amount"
      />
      <input
        name="paid_at"
        type="date"
        defaultValue={today}
        className="sm:col-span-3 border border-slate-300 dark:border-slate-700 rounded px-3 py-2 text-sm bg-white dark:bg-slate-900"
      />
      <select
        name="method"
        defaultValue="check"
        className="sm:col-span-2 border border-slate-300 dark:border-slate-700 rounded px-3 py-2 text-sm bg-white dark:bg-slate-900 capitalize"
      >
        {METHODS.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      <input
        name="note"
        placeholder="Note (optional)"
        className="sm:col-span-3 border border-slate-300 dark:border-slate-700 rounded px-3 py-2 text-sm bg-white dark:bg-slate-900"
      />
      <button
        type="submit"
        disabled={pending}
        className="sm:col-span-1 inline-flex items-center justify-center gap-1 bg-slate-900 text-white rounded px-3 py-2 text-sm hover:bg-slate-800 disabled:opacity-50"
      >
        {pending ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <Plus size={14} />
        )}
        Add
      </button>
      {error && (
        <p className="sm:col-span-12 text-sm text-rose-700 dark:text-rose-300">
          {error}
        </p>
      )}
    </form>
  );
}

function PaymentRow({
  stageId,
  p,
}: {
  stageId: string;
  p: StagePaymentRow;
}) {
  const [pending, startTransition] = useTransition();
  const [confirmDel, setConfirmDel] = useState(false);

  function del() {
    if (!confirmDel) {
      setConfirmDel(true);
      setTimeout(() => setConfirmDel(false), 4000);
      return;
    }
    startTransition(async () => {
      await deleteStagePaymentAction(p.id, stageId);
    });
  }

  return (
    <li className="py-2.5 flex items-center justify-between gap-3 text-sm">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium tabular-nums text-slate-900 dark:text-slate-100">
            {fmtMoney(Number(p.amount))}
          </span>
          <span className="text-slate-600 dark:text-slate-400">
            {formatMDY(p.paid_at)}
          </span>
          {p.method && (
            <span className="px-1.5 py-0.5 rounded text-[11px] capitalize bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
              {p.method}
            </span>
          )}
        </div>
        {p.note && (
          <div className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
            {p.note}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={del}
        disabled={pending}
        className={`shrink-0 inline-flex items-center gap-1 text-xs rounded px-2 py-1 disabled:opacity-50 ${
          confirmDel
            ? "bg-rose-600 text-white"
            : "border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
        }`}
      >
        {pending ? (
          <Loader2 size={11} className="animate-spin" />
        ) : (
          <Trash2 size={11} />
        )}
        {confirmDel ? "Confirm" : "Delete"}
      </button>
    </li>
  );
}

"use client";

import { useMemo, useState, useTransition } from "react";
import { Trash2, Plus, CheckCircle2, Loader2 } from "lucide-react";
import { formatMDY } from "@/lib/time";
import { fmtMoney } from "@/lib/custom-invoice";
import {
  recordInvoicePaymentAction,
  deleteInvoicePaymentAction,
} from "@/app/(app)/invoices/actions";

export type InvoicePaymentRow = {
  id: string;
  amount: number;
  paid_at: string;
  method: string | null;
  note: string | null;
};

const METHODS = ["check", "cash", "zelle", "card", "other"] as const;

/**
 * Payments ledger for a standalone invoice — same shape as the stage
 * PaymentsSection. Status flips to paid by trigger once the ledger
 * covers the total, so partial payments / deposits just work.
 */
export default function InvoicePaymentsSection({
  invoiceId,
  total,
  payments,
  readOnly = false,
}: {
  invoiceId: string;
  total: number;
  payments: InvoicePaymentRow[];
  /** Void invoices show the ledger but don't take new payments. */
  readOnly?: boolean;
}) {
  const paid = useMemo(
    () => payments.reduce((sum, p) => sum + Number(p.amount || 0), 0),
    [payments],
  );
  const outstanding = Math.max(total - paid, 0);
  const isPaidInFull = total > 0 && outstanding <= 0;

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

      <div className="grid grid-cols-3 gap-3 text-sm">
        <SumCell label="Invoice">{fmtMoney(total)}</SumCell>
        <SumCell label="Paid so far" tone="text-emerald-700">
          {fmtMoney(paid)}
        </SumCell>
        <SumCell
          label="Outstanding"
          tone={outstanding > 0 ? "text-rose-700" : "text-slate-500"}
        >
          {fmtMoney(outstanding)}
        </SumCell>
      </div>

      {!readOnly && !isPaidInFull && total > 0 && (
        <RecordPaymentForm invoiceId={invoiceId} defaultAmount={outstanding} />
      )}

      {payments.length > 0 ? (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800 border-t border-slate-100 dark:border-slate-800">
          {payments.map((p) => (
            <PaymentRow key={p.id} invoiceId={invoiceId} p={p} readOnly={readOnly} />
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
  invoiceId,
  defaultAmount,
}: {
  invoiceId: string;
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
      const res = await recordInvoicePaymentAction(invoiceId, fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      form.reset();
    });
  }

  const field =
    "border border-slate-300 dark:border-slate-700 rounded px-3 py-2 text-sm bg-white dark:bg-slate-900";

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
        className={`sm:col-span-3 ${field} tabular-nums`}
        placeholder="Amount"
      />
      <input
        name="paid_at"
        type="date"
        defaultValue={today}
        className={`sm:col-span-3 ${field}`}
      />
      <select
        name="method"
        defaultValue="check"
        className={`sm:col-span-2 ${field} capitalize`}
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
        className={`sm:col-span-3 ${field}`}
      />
      <button
        type="submit"
        disabled={pending}
        className="sm:col-span-1 inline-flex items-center justify-center gap-1 bg-slate-900 text-white rounded px-3 py-2 text-sm hover:bg-slate-800 disabled:opacity-50"
      >
        {pending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
        Add
      </button>
      {error && (
        <p className="sm:col-span-12 text-sm text-rose-700 dark:text-rose-300">{error}</p>
      )}
    </form>
  );
}

function PaymentRow({
  invoiceId,
  p,
  readOnly,
}: {
  invoiceId: string;
  p: InvoicePaymentRow;
  readOnly: boolean;
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
      await deleteInvoicePaymentAction(p.id, invoiceId);
    });
  }

  return (
    <li className="py-2.5 flex items-center justify-between gap-3 text-sm">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium tabular-nums text-slate-900 dark:text-slate-100">
            {fmtMoney(Number(p.amount))}
          </span>
          <span className="text-slate-600 dark:text-slate-400">{formatMDY(p.paid_at)}</span>
          {p.method && (
            <span className="px-1.5 py-0.5 rounded text-[11px] capitalize bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
              {p.method}
            </span>
          )}
        </div>
        {p.note && (
          <div className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">{p.note}</div>
        )}
      </div>
      {!readOnly && (
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
          {pending ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
          {confirmDel ? "Confirm" : "Delete"}
        </button>
      )}
    </li>
  );
}

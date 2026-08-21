"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, FileText, Loader2, Mail } from "lucide-react";
import {
  reportArrivalIssueAction,
  approveFeeInvoiceAction,
  dismissFeeAction,
  setFeePaidAction,
} from "@/app/(app)/stages/actions";
import {
  ARRIVAL_FEE_REASONS,
  ARRIVAL_FEE_KEYS,
  arrivalFeeLabels,
  type ArrivalFeeReason,
} from "@/lib/arrival-fees";
import { formatMDY } from "@/lib/time";

export type FeeRow = {
  id: string;
  reasons: string[];
  note: string | null;
  amount: number;
  status: "pending" | "sent" | "paid" | "dismissed";
  reported_by_name: string | null;
  reported_at: string;
  invoice_number: string | null;
  pdf_url: string | null;
  sent_at: string | null;
  paid_at: string | null;
};

/**
 * Stage-page card for arrival issues. Every team member can report
 * (checkboxes + note → a pending fee invoice); admins see each report
 * with Approve & email / Dismiss / Mark paid. Nothing reaches the
 * client until an admin approves.
 */
export default function ArrivalIssuesCard({
  stageId,
  isAdmin,
  clientEmail,
  fees,
}: {
  stageId: string;
  isAdmin: boolean;
  clientEmail: string | null;
  fees: FeeRow[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<ArrivalFeeReason>>(new Set());
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reported, setReported] = useState(false);

  const total = Array.from(selected).reduce(
    (s, r) => s + ARRIVAL_FEE_REASONS[r].amount,
    0,
  );

  function toggle(r: ArrivalFeeReason) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(r)) next.delete(r);
      else next.add(r);
      return next;
    });
  }

  function report() {
    setError(null);
    startTransition(async () => {
      const res = await reportArrivalIssueAction(stageId, {
        reasons: Array.from(selected),
        note,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setReported(true);
      setSelected(new Set());
      setNote("");
      router.refresh();
    });
  }

  const visible = fees.filter((f) => isAdmin || f.status !== "dismissed");

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 p-3 space-y-3">
      <div className="flex items-center gap-2.5">
        <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 text-slate-600 dark:text-slate-300 shrink-0">
          <AlertTriangle size={15} />
        </span>
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Arrival issues
          </div>
          <div className="text-sm text-slate-700 dark:text-slate-300">
            Problem when the crew arrived? Report it — an extra-fee invoice
            is drafted for an admin to approve.
          </div>
        </div>
      </div>

      {/* Report form — every team member */}
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          {ARRIVAL_FEE_KEYS.map((r) => {
            const on = selected.has(r);
            return (
              <label
                key={r}
                className={`inline-flex items-center gap-2 text-sm rounded-lg px-3 py-2 border cursor-pointer select-none ${
                  on
                    ? "bg-amber-50 border-amber-300 text-amber-900 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-200"
                    : "bg-white border-slate-200 text-slate-700 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-300"
                }`}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggle(r)}
                  disabled={pending}
                  className="accent-amber-600"
                />
                {ARRIVAL_FEE_REASONS[r].label}
                <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                  ${ARRIVAL_FEE_REASONS[r].amount}
                </span>
              </label>
            );
          })}
        </div>
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional note (what happened)"
              maxLength={500}
              disabled={pending}
              className="flex-1 min-w-[200px] border border-slate-300 dark:border-slate-600 rounded px-3 py-2 text-sm bg-white dark:bg-slate-900"
            />
            <button
              type="button"
              onClick={report}
              disabled={pending}
              className="inline-flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-60"
            >
              {pending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <AlertTriangle size={14} />
              )}
              Report · ${total} fee
            </button>
          </div>
        )}
        {reported && selected.size === 0 && (
          <p className="text-xs text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1">
            <Check size={12} /> Reported — admins have been notified and the
            fee invoice is waiting for approval.
          </p>
        )}
        {error && <p className="text-xs text-rose-700">{error}</p>}
      </div>

      {/* Existing reports */}
      {visible.length > 0 && (
        <ul className="divide-y divide-slate-200 dark:divide-slate-700 border-t border-slate-200 dark:border-slate-700 pt-1">
          {visible.map((f) => (
            <FeeRowItem
              key={f.id}
              fee={f}
              isAdmin={isAdmin}
              clientEmail={clientEmail}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: FeeRow["status"] }) {
  const cls =
    status === "pending"
      ? "bg-amber-100 text-amber-800 ring-amber-200 dark:bg-amber-950/50 dark:text-amber-200 dark:ring-amber-900/60"
      : status === "sent"
        ? "bg-indigo-100 text-indigo-800 ring-indigo-200 dark:bg-indigo-950/50 dark:text-indigo-200 dark:ring-indigo-900/60"
        : status === "paid"
          ? "bg-emerald-100 text-emerald-800 ring-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-200 dark:ring-emerald-900/60"
          : "bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700";
  const label =
    status === "pending"
      ? "Awaiting approval"
      : status === "sent"
        ? "Invoice sent"
        : status === "paid"
          ? "Paid"
          : "Dismissed";
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1 ring-inset ${cls}`}
    >
      {label}
    </span>
  );
}

function FeeRowItem({
  fee,
  isAdmin,
  clientEmail,
}: {
  fee: FeeRow;
  isAdmin: boolean;
  clientEmail: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [armed, setArmed] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setErr(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) setErr(r.error);
      setArmed(false);
      router.refresh();
    });
  }

  return (
    <li className="py-2.5 space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
            {arrivalFeeLabels(fee.reasons).join(" + ")}{" "}
            <span className="tabular-nums">· ${fee.amount.toFixed(2)}</span>
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Reported {formatMDY(new Date(fee.reported_at))}
            {fee.reported_by_name ? ` by ${fee.reported_by_name}` : ""}
            {fee.invoice_number ? ` · ${fee.invoice_number}` : ""}
            {fee.sent_at ? ` · sent ${formatMDY(new Date(fee.sent_at))}` : ""}
            {fee.paid_at ? ` · paid ${formatMDY(new Date(fee.paid_at))}` : ""}
          </div>
          {fee.note && (
            <div className="text-xs text-slate-600 dark:text-slate-400 italic">
              &ldquo;{fee.note}&rdquo;
            </div>
          )}
        </div>
        <StatusPill status={fee.status} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {fee.pdf_url && (
          <a
            href={fee.pdf_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 rounded-lg px-2.5 py-1 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
          >
            <FileText size={12} /> Invoice PDF
          </a>
        )}
        {isAdmin && fee.status === "pending" && !armed && (
          <>
            <button
              type="button"
              onClick={() => setArmed(true)}
              disabled={pending}
              className="inline-flex items-center gap-1 text-xs bg-slate-900 text-white dark:bg-white dark:text-slate-900 rounded-lg px-2.5 py-1 disabled:opacity-60"
            >
              <Mail size={12} /> Approve &amp; email client
            </button>
            <button
              type="button"
              onClick={() => run(() => dismissFeeAction(fee.id))}
              disabled={pending}
              className="text-xs text-slate-600 dark:text-slate-400 hover:underline disabled:opacity-60"
            >
              Dismiss
            </button>
          </>
        )}
        {isAdmin && fee.status === "pending" && armed && (
          <span className="inline-flex flex-wrap items-center gap-1 rounded-full bg-slate-100 dark:bg-slate-800/70 ring-1 ring-slate-200 dark:ring-slate-700 px-1 py-0.5">
            <span className="text-[11px] text-slate-600 dark:text-slate-300 pl-1.5">
              Email ${fee.amount.toFixed(2)} invoice to {clientEmail ?? "client"}?
            </span>
            <button
              type="button"
              onClick={() => setArmed(false)}
              disabled={pending}
              className="text-[11px] font-medium text-slate-700 dark:text-slate-300 px-2 py-0.5 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => run(() => approveFeeInvoiceAction(fee.id))}
              disabled={pending}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-white bg-slate-900 dark:bg-white dark:text-slate-900 px-2 py-0.5 rounded-full disabled:opacity-60"
            >
              {pending ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <Mail size={11} />
              )}
              Send
            </button>
          </span>
        )}
        {isAdmin && fee.status === "sent" && (
          <button
            type="button"
            onClick={() => run(() => setFeePaidAction(fee.id, true))}
            disabled={pending}
            className="inline-flex items-center gap-1 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg px-2.5 py-1 disabled:opacity-60"
          >
            <Check size={12} /> Mark paid
          </button>
        )}
        {isAdmin && fee.status === "paid" && (
          <button
            type="button"
            onClick={() => run(() => setFeePaidAction(fee.id, false))}
            disabled={pending}
            className="text-xs text-slate-600 dark:text-slate-400 hover:underline disabled:opacity-60"
          >
            Mark unpaid
          </button>
        )}
        {err && <span className="text-xs text-rose-700">{err}</span>}
      </div>
    </li>
  );
}

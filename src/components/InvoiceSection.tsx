"use client";

import { useState, useTransition } from "react";
import { Loader2, FileText, Check, RotateCcw, Send } from "lucide-react";
import {
  generateInvoiceAction,
  markPaidAction,
  unmarkPaidAction,
  sendInvoiceEmailAction,
} from "@/app/(app)/stages/actions";

type Props = {
  stageId: string;
  isAdmin: boolean;
  invoicePdfUrl: string | null;
  invoiceGeneratedAt: string | null;
  invoiceSentAt: string | null;
  clientEmail: string | null;
  paidAt: string | null;
  paymentMethod: string | null;
  amount: number;
};

const METHODS = [
  { value: "check", label: "Check" },
  { value: "cash", label: "Cash" },
  { value: "zelle", label: "Zelle" },
  { value: "venmo", label: "Venmo" },
  { value: "card", label: "Card" },
  { value: "other", label: "Other" },
];

// Format any ISO date or timestamp as mm/dd/yy to match the rest of
// the app. Handles a full ISO string like "2026-05-23T00:00:00Z" by
// reading just the date portion.
function fmt(date: string): string {
  const m = String(date).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(date);
  return `${m[2]}/${m[3]}/${m[1].slice(-2)}`;
}

export default function InvoiceSection({
  stageId,
  isAdmin,
  invoicePdfUrl,
  invoiceGeneratedAt,
  invoiceSentAt,
  clientEmail,
  paidAt,
  paymentMethod,
  amount,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<
    "gen" | "mark" | "unmark" | "send" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [sendOk, setSendOk] = useState(false);
  const todayISO = new Date().toISOString().slice(0, 10);
  // Defaults: when editing an existing payment, prefill with the
  // current method + date so the admin can tweak one field without
  // re-typing the other.
  const paidAtISO = (paidAt || "").slice(0, 10) || todayISO;
  const [method, setMethod] = useState(paymentMethod || "check");
  const [paidDate, setPaidDate] = useState(paidAtISO);
  const [editing, setEditing] = useState(false);

  function onGenerate() {
    setError(null);
    setBusy("gen");
    startTransition(async () => {
      const r = await generateInvoiceAction(stageId);
      if (!r.ok) setError(r.error);
      setBusy(null);
    });
  }

  function onSend() {
    setError(null);
    setSendOk(false);
    if (
      !confirm(
        `Email this invoice to ${clientEmail}? They'll get a link to the PDF.`
      )
    )
      return;
    setBusy("send");
    startTransition(async () => {
      const r = await sendInvoiceEmailAction(stageId);
      if (!r.ok) setError(r.error);
      else setSendOk(true);
      setBusy(null);
    });
  }

  function onMarkPaid() {
    setError(null);
    setBusy("mark");
    const fd = new FormData();
    fd.set("method", method);
    fd.set("paid_at", paidDate);
    startTransition(async () => {
      const r = await markPaidAction(stageId, fd);
      if (!r.ok) setError(r.error);
      else setEditing(false);
      setBusy(null);
    });
  }

  function onUnmark() {
    if (!confirm("Reopen this invoice (clear the paid date)?")) return;
    setError(null);
    setBusy("unmark");
    startTransition(async () => {
      const r = await unmarkPaidAction(stageId);
      if (!r.ok) setError(r.error);
      setBusy(null);
    });
  }

  return (
    <section className="bg-white dark:bg-slate-900 border rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Invoice</h2>
        {paidAt ? (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium ring-1 ring-inset bg-emerald-50 text-emerald-700 ring-emerald-200">
            <Check size={12} /> Paid
            {paymentMethod ? ` · ${paymentMethod}` : ""}
          </span>
        ) : (
          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ring-1 ring-inset bg-amber-50 text-amber-800 ring-amber-200">
            Unpaid · ${amount.toFixed(2)}
          </span>
        )}
      </div>

      <div className="text-sm text-slate-700 dark:text-slate-300 space-y-1">
        {invoiceGeneratedAt && (
          <div className="text-slate-600 dark:text-slate-400">
            PDF generated {fmt(invoiceGeneratedAt)}
          </div>
        )}
        {invoiceSentAt && (
          <div className="text-slate-600 dark:text-slate-400">
            Emailed {fmt(invoiceSentAt)}
            {clientEmail ? ` to ${clientEmail}` : ""}
          </div>
        )}
        {paidAt && (
          <div className="text-slate-600 dark:text-slate-400">Paid on {fmt(paidAt)}</div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {isAdmin && (
          <button
            type="button"
            onClick={onGenerate}
            disabled={pending}
            className="inline-flex items-center gap-1.5 text-sm bg-slate-900 text-white rounded-lg px-3 py-2 hover:bg-slate-800 disabled:opacity-60"
          >
            {busy === "gen" ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Generating…
              </>
            ) : (
              <>
                <FileText size={14} />{" "}
                {invoicePdfUrl ? "Regenerate PDF" : "Generate invoice PDF"}
              </>
            )}
          </button>
        )}
        {invoicePdfUrl && (
          <a
            href={invoicePdfUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-900"
          >
            View invoice PDF →
          </a>
        )}
        {isAdmin && clientEmail && (
          <button
            type="button"
            onClick={onSend}
            disabled={pending}
            title={
              invoiceSentAt
                ? `Re-send the invoice to ${clientEmail}`
                : `Email the invoice to ${clientEmail}`
            }
            className="inline-flex items-center gap-1.5 text-sm bg-brand hover:bg-brand-hover text-white rounded-lg px-3 py-2 disabled:opacity-60"
          >
            {busy === "send" ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Sending…
              </>
            ) : (
              <>
                <Send size={14} />{" "}
                {invoiceSentAt ? "Resend invoice email" : "Email invoice"}
              </>
            )}
          </button>
        )}
      </div>
      {sendOk && (
        <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-2">
          Invoice sent to {clientEmail}.
        </p>
      )}

      {isAdmin && (
        <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
          {paidAt && !editing ? (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  // Snap inputs back to current values so the editor
                  // opens prefilled even if the user opened/closed it
                  // before.
                  setMethod(paymentMethod || "check");
                  setPaidDate(paidAtISO);
                  setEditing(true);
                }}
                disabled={pending}
                className="inline-flex items-center gap-1.5 text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60"
              >
                Edit payment
              </button>
              <button
                type="button"
                onClick={onUnmark}
                disabled={pending}
                className="inline-flex items-center gap-1.5 text-sm text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 disabled:opacity-60"
              >
                {busy === "unmark" ? (
                  <>
                    <Loader2 size={14} className="animate-spin" /> Reopening…
                  </>
                ) : (
                  <>
                    <RotateCcw size={14} /> Reopen invoice
                  </>
                )}
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400">
                {paidAt ? "Edit payment" : "Mark as paid"}
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <label className="block text-sm">
                  <span className="block text-xs text-slate-600 dark:text-slate-400 mb-0.5">
                    Method
                  </span>
                  <select
                    value={method}
                    onChange={(e) => setMethod(e.target.value)}
                    className="border rounded-lg px-3 py-2 text-sm"
                  >
                    {METHODS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="block text-xs text-slate-600 dark:text-slate-400 mb-0.5">
                    Paid on
                  </span>
                  <input
                    type="date"
                    value={paidDate}
                    onChange={(e) => setPaidDate(e.target.value)}
                    className="border rounded-lg px-3 py-2 text-sm"
                  />
                </label>
                <button
                  type="button"
                  onClick={onMarkPaid}
                  disabled={pending}
                  className="inline-flex items-center gap-1.5 text-sm bg-emerald-600 text-white rounded-lg px-3 py-2 hover:bg-emerald-700 disabled:opacity-60"
                >
                  {busy === "mark" ? (
                    <>
                      <Loader2 size={14} className="animate-spin" /> Saving…
                    </>
                  ) : (
                    <>
                      <Check size={14} /> {paidAt ? "Save changes" : "Mark paid"}
                    </>
                  )}
                </button>
                {paidAt && editing && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(false);
                      setError(null);
                    }}
                    disabled={pending}
                    className="inline-flex items-center text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 disabled:opacity-60"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">
          {error}
        </p>
      )}
    </section>
  );
}

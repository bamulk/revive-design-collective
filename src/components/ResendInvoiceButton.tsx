"use client";

import { useState, useTransition } from "react";
import { Check, Loader2, Mail } from "lucide-react";
import { sendInvoiceEmailAction } from "@/app/(app)/stages/actions";

/**
 * Compact "Resend invoice" control for the dashboard's Outstanding
 * invoices rows. Reuses sendInvoiceEmailAction — the same pipeline as
 * the stage page's Email-invoice button (generates the PDF if missing,
 * emails the client on file, stamps invoice_sent_at).
 *
 * Two-step: first tap arms an inline confirm (an accidental tap on a
 * dashboard list must never email a client), second tap sends.
 */
export default function ResendInvoiceButton({
  stageId,
  clientEmail,
  invoiceSentAt,
}: {
  stageId: string;
  clientEmail: string | null;
  invoiceSentAt: string | null;
}) {
  const [armed, setArmed] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const label = invoiceSentAt || sent ? "Resend invoice" : "Send invoice";

  // No email on file — the send would fail, so say why instead of
  // offering a dead button.
  if (!clientEmail) {
    return (
      <span
        className="inline-flex items-center gap-1 text-xs text-slate-400 dark:text-slate-500"
        title="Add an email on the client's page to send invoices"
      >
        <Mail size={12} /> No client email
      </span>
    );
  }

  if (sent && !armed) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-300">
        <Check size={12} /> Sent
      </span>
    );
  }

  function send() {
    setError(null);
    startTransition(async () => {
      const r = await sendInvoiceEmailAction(stageId);
      if (r.ok) {
        setSent(true);
        setArmed(false);
      } else {
        setError(r.error || "Send failed");
        setArmed(false);
      }
    });
  }

  if (!armed) {
    return (
      <span className="inline-flex flex-col items-end gap-0.5">
        <button
          type="button"
          onClick={() => {
            setError(null);
            setArmed(true);
          }}
          className="inline-flex items-center gap-1.5 text-xs border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 rounded-lg px-2.5 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
        >
          <Mail size={12} /> {label}
        </button>
        {error && (
          <span className="text-[11px] text-rose-700 max-w-[14rem] text-right leading-tight">
            {error}
          </span>
        )}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 dark:bg-slate-800/70 ring-1 ring-slate-200 dark:ring-slate-700 px-1 py-0.5">
      <span
        className="text-[11px] text-slate-600 dark:text-slate-300 pl-1.5 max-w-[12rem] truncate"
        title={clientEmail}
      >
        Email {clientEmail}?
      </span>
      <button
        type="button"
        onClick={() => setArmed(false)}
        disabled={pending}
        className="text-[11px] font-medium text-slate-700 dark:text-slate-300 px-2 py-0.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-60"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={send}
        disabled={pending}
        className="inline-flex items-center gap-1 text-[11px] font-semibold text-white bg-slate-900 dark:bg-white dark:text-slate-900 px-2 py-0.5 rounded-full disabled:opacity-60"
      >
        {pending ? (
          <>
            <Loader2 size={11} className="animate-spin" /> Sending…
          </>
        ) : (
          <>
            <Mail size={11} /> Send
          </>
        )}
      </button>
    </span>
  );
}

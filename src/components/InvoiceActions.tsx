"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  Send,
  RefreshCw,
  FileText,
  Pencil,
  Ban,
  RotateCcw,
  Trash2,
  Loader2,
} from "lucide-react";
import {
  sendInvoiceAction,
  regenerateInvoicePdfAction,
  setInvoiceVoidAction,
  deleteInvoiceAction,
} from "@/app/(app)/invoices/actions";

/**
 * Action bar for one standalone invoice: open PDF, send/resend, edit,
 * void/restore, delete. Send and delete are two-step so a stray tap
 * can't email a client or drop a record.
 */
export default function InvoiceActions({
  invoiceId,
  status,
  pdfUrl,
  hasEmail,
  hasPayments,
  sentAt,
}: {
  invoiceId: string;
  status: string;
  pdfUrl: string | null;
  hasEmail: boolean;
  hasPayments: boolean;
  sentAt: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [confirm, setConfirm] = useState<"send" | "delete" | "void" | null>(null);

  const isVoid = status === "void";
  const isPaid = status === "paid";
  const editable = !isVoid && !isPaid;

  function run(key: string, fn: () => Promise<{ ok: true } | { ok: false; error: string } | void>, okText?: string) {
    setMsg(null);
    setBusy(key);
    startTransition(async () => {
      try {
        const r = await fn();
        if (r && !r.ok) setMsg({ tone: "err", text: r.error });
        else if (okText) setMsg({ tone: "ok", text: okText });
      } catch (e: unknown) {
        setMsg({
          tone: "err",
          text: e instanceof Error && e.message ? e.message : "Something went wrong.",
        });
      } finally {
        setBusy(null);
        setConfirm(null);
      }
    });
  }

  const btn =
    "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm disabled:opacity-60";
  const neutral = `${btn} border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800`;
  const primary = `${btn} border-transparent text-white bg-brand hover:bg-brand-hover`;
  const danger = `${btn} border-rose-300 text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/30`;

  const spin = (key: string) =>
    pending && busy === key ? <Loader2 size={14} className="animate-spin" /> : null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {pdfUrl && (
          <a href={pdfUrl} target="_blank" rel="noopener noreferrer" className={neutral}>
            <FileText size={14} /> View PDF
          </a>
        )}

        {!isVoid && (
          confirm === "send" ? (
            <>
              <button
                type="button"
                disabled={pending}
                onClick={() => run("send", () => sendInvoiceAction(invoiceId), "Invoice emailed.")}
                className={primary}
              >
                {spin("send") ?? <Send size={14} />}
                {sentAt ? "Yes, resend it" : "Yes, send it"}
              </button>
              <button type="button" onClick={() => setConfirm(null)} className={neutral}>
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={pending || !hasEmail}
              title={hasEmail ? undefined : "Add an email under Bill To first"}
              onClick={() => setConfirm("send")}
              className={sentAt ? neutral : primary}
            >
              <Send size={14} /> {sentAt ? "Resend" : "Send invoice"}
            </button>
          )
        )}

        {editable && (
          <Link href={`/invoices/${invoiceId}/edit`} className={neutral}>
            <Pencil size={14} /> Edit
          </Link>
        )}

        {!isVoid && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run("pdf", () => regenerateInvoicePdfAction(invoiceId), "PDF rebuilt.")
            }
            className={neutral}
          >
            {spin("pdf") ?? <RefreshCw size={14} />} Rebuild PDF
          </button>
        )}

        {isVoid ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => run("void", () => setInvoiceVoidAction(invoiceId, false), "Invoice restored.")}
            className={neutral}
          >
            {spin("void") ?? <RotateCcw size={14} />} Restore
          </button>
        ) : confirm === "void" ? (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() => run("void", () => setInvoiceVoidAction(invoiceId, true), "Invoice voided.")}
              className={danger}
            >
              {spin("void") ?? <Ban size={14} />} Yes, void it
            </button>
            <button type="button" onClick={() => setConfirm(null)} className={neutral}>
              Cancel
            </button>
          </>
        ) : (
          <button type="button" disabled={pending} onClick={() => setConfirm("void")} className={danger}>
            <Ban size={14} /> Void
          </button>
        )}

        {!hasPayments && (
          confirm === "delete" ? (
            <>
              <button
                type="button"
                disabled={pending}
                onClick={() => run("delete", () => deleteInvoiceAction(invoiceId))}
                className={danger}
              >
                {spin("delete") ?? <Trash2 size={14} />} Yes, delete
              </button>
              <button type="button" onClick={() => setConfirm(null)} className={neutral}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" disabled={pending} onClick={() => setConfirm("delete")} className={danger}>
              <Trash2 size={14} /> Delete
            </button>
          )
        )}
      </div>

      {confirm === "send" && (
        <p className="text-xs text-amber-800 dark:text-amber-200">
          This emails the PDF to the Bill To address (admins are BCC&rsquo;d).
        </p>
      )}
      {msg && (
        <p
          className={`text-xs ${
            msg.tone === "ok" ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300"
          }`}
        >
          {msg.text}
        </p>
      )}
    </div>
  );
}

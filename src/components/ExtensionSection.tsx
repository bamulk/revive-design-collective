"use client";

import { useState, useTransition } from "react";
import {
  Loader2,
  FileText,
  Check,
  RotateCcw,
  Mail,
  AlertCircle,
  Trash2,
} from "lucide-react";
import { formatMDY } from "@/lib/time";
import {
  markExtensionPaidAction,
  unmarkExtensionPaidAction,
  deleteExtensionAction,
} from "@/app/(app)/stages/actions";
import ManualExtensionForm from "./ManualExtensionForm";
import ResendExtensionButton from "./ResendExtensionButton";

export type ExtensionRow = {
  id: string;
  /** When the extension period begins. */
  extension_date: string | null;
  amount: number;
  paid_at: string | null;
  pdf_url: string | null;
  pdf_sent_at: string | null;
  source: "manual" | "auto";
  created_at: string;
  /** Lightweight acceptance record (client one-tap confirmations). */
  accepted_at?: string | null;
  accepted_by?: string | null;
};

type Props = {
  stageId: string;
  extensions: ExtensionRow[];
  /** Current destage_date — the "extended through" date. */
  destageDate: string | null;
  /** Stage amount, used to suggest a default for manual entries. */
  stageAmount: number;
  /** For the per-row Send/Resend invoice button. */
  clientEmail: string | null;
};

/**
 * Stage-detail panel listing every extension this stage has had, with
 * an inline "Record extension" form for back-filling handshake
 * extensions. Always renders (admin can record an extension even when
 * there are none yet).
 */
export default function ExtensionSection({
  stageId,
  extensions,
  destageDate,
  stageAmount,
  clientEmail,
}: Props) {
  const total = extensions.reduce((s, e) => s + Number(e.amount || 0), 0);
  // Standard extension term is 30 days (matches the /x auto flow).
  const defaultNewDestageDate = destageDate
    ? addDaysISO(destageDate, 30)
    : null;

  return (
    <section className="bg-white dark:bg-slate-900 border rounded-xl p-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">Staging extensions</h2>
        {extensions.length > 0 ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-purple-100 dark:bg-purple-950/40 text-purple-800 dark:text-purple-300 ring-1 ring-inset ring-purple-200 dark:ring-purple-900/50">
            {extensions.length} extension
            {extensions.length === 1 ? "" : "s"} · through{" "}
            {formatMDY(destageDate)}
          </span>
        ) : (
          <span className="text-xs text-slate-500 dark:text-slate-400">
            None yet — record one below
          </span>
        )}
      </div>

      {extensions.length > 0 && (
        <>
          <div className="space-y-2">
            {extensions.map((e, i) => (
              <ExtensionRowCard
                key={e.id}
                row={e}
                stageId={stageId}
                index={extensions.length - i}
                clientEmail={clientEmail}
              />
            ))}
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-sm">
            <span className="text-slate-600 dark:text-slate-400">
              Total billed
            </span>
            <span className="font-semibold tabular-nums">
              ${total.toFixed(2)}
            </span>
          </div>
        </>
      )}

      <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
        <ManualExtensionForm
          stageId={stageId}
          defaultAmount={Math.round(stageAmount * 0.5)}
          defaultNewDestageDate={defaultNewDestageDate}
        />
      </div>
    </section>
  );
}

/**
 * Inline helper to compute new destage_date when extending — kept
 * here so we don't import a server-only helper into this client file.
 */
function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = Date.UTC(y, (m ?? 1) - 1, d ?? 1) + days * 86400000;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(
    2,
    "0",
  )}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function ExtensionRowCard({
  row,
  stageId,
  index,
  clientEmail,
}: {
  row: ExtensionRow;
  stageId: string;
  index: number;
  clientEmail: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const paid = !!row.paid_at;

  function togglePaid() {
    setErr(null);
    startTransition(async () => {
      const fn = paid ? unmarkExtensionPaidAction : markExtensionPaidAction;
      const res = await fn(row.id, stageId);
      if (!res.ok) setErr(res.error);
    });
  }

  function fireDelete() {
    setErr(null);
    startTransition(async () => {
      const res = await deleteExtensionAction(row.id, stageId);
      if (!res.ok) {
        setErr(res.error);
        setConfirmingDelete(false);
      }
    });
  }

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
            Extension #{index}
            {row.extension_date && (
              <span className="text-slate-500 dark:text-slate-400 font-normal">
                {" "}
                · {formatMDY(row.extension_date)}
              </span>
            )}
          </div>
          <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 mt-0.5">
            {row.source === "auto" ? "Auto (client confirmed)" : "Recorded manually"}
          </div>
          {row.accepted_at && (
            <div className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-1">
              Accepted{row.accepted_by ? ` by ${row.accepted_by}` : ""} on{" "}
              {new Date(row.accepted_at).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </div>
          )}
        </div>
        <div className="text-sm font-semibold tabular-nums text-right">
          ${Number(row.amount || 0).toFixed(2)}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        {/* Paid badge */}
        {paid ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-medium ring-1 ring-inset bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-900/50">
            <Check size={11} /> Paid {formatMDY(row.paid_at)}
          </span>
        ) : (
          <span className="inline-flex items-center px-2 py-0.5 rounded-md font-medium ring-1 ring-inset bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 ring-amber-200 dark:ring-amber-900/50">
            Unpaid
          </span>
        )}
        {/* Invoice PDF + sent state. Manual entries don't have a PDF
            and the "RECORDED MANUALLY" label above already conveys
            that — so we hide this pill entirely for manual rows. */}
        {row.pdf_url ? (
          <>
            <a
              href={row.pdf_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md ring-1 ring-inset bg-white dark:bg-slate-900 text-brand dark:text-gold ring-slate-200 dark:ring-slate-700 hover:bg-amber-50 dark:hover:bg-amber-950/30"
            >
              <FileText size={11} /> Invoice PDF
            </a>
            {row.pdf_sent_at ? (
              <span className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-400">
                <Mail size={11} /> Sent {formatMDY(row.pdf_sent_at)}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400 italic">
                <Mail size={11} /> Not sent
              </span>
            )}
          </>
        ) : row.source === "auto" ? (
          <span className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400 italic">
            <FileText size={11} /> No PDF
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="button"
          onClick={togglePaid}
          disabled={pending}
          className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md ${
            paid
              ? "border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
              : "bg-emerald-600 hover:bg-emerald-700 text-white"
          } disabled:opacity-60`}
        >
          {pending ? (
            <Loader2 size={12} className="animate-spin" />
          ) : paid ? (
            <RotateCcw size={12} />
          ) : (
            <Check size={12} />
          )}
          {paid ? "Mark unpaid" : "Mark paid"}
        </button>

        {/* Two-step delete: first click arms, second confirms. */}
        {confirmingDelete ? (
          <>
            <button
              type="button"
              onClick={fireDelete}
              disabled={pending}
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md bg-rose-700 hover:bg-rose-800 text-white disabled:opacity-60"
            >
              {pending ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Trash2 size={12} />
              )}
              Confirm delete
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              disabled={pending}
              className="inline-flex items-center text-xs px-2.5 py-1 rounded-md text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-60"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            disabled={pending}
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border border-rose-200 dark:border-rose-900/60 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/30 disabled:opacity-60"
          >
            <Trash2 size={12} />
            Delete
          </button>
        )}

        {/* Send/Resend the extension invoice — same control as the
            dashboard's Outstanding extensions rows. Sending stamps
            pdf_sent_at, which arms the payment-reminder clock. */}
        <span className="ml-auto">
          <ResendExtensionButton
            extensionId={row.id}
            clientEmail={clientEmail}
            pdfSentAt={row.pdf_sent_at}
          />
        </span>
      </div>

      {err && (
        <p className="text-xs text-rose-700 flex items-center gap-1">
          <AlertCircle size={11} /> {err}
        </p>
      )}
    </div>
  );
}

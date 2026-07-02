"use client";

import { useState, useTransition } from "react";
import { Loader2, FileSignature, Check } from "lucide-react";
import {
  sendNewAgreementForStageAction,
  type SignatureSendResult,
} from "@/app/(app)/stages/actions";

/**
 * "Send updated agreement" — regenerates the contract from the current
 * stage data (e.g. after the amount changed), voiding the existing
 * envelope and sending a fresh one for signature. On completion the
 * webhook will produce a corrected invoice for the new amount.
 *
 * Distinct from the plain "Resend" button, which just re-delivers the
 * SAME (stale) envelope to signers who haven't completed.
 *
 * Two-step confirm because it replaces the current agreement and clears
 * the prior signed PDF / invoice.
 */
export default function NewAgreementButton({
  stageId,
  label = "Send updated agreement",
  confirmPrompt = "Replace the current agreement and send a new one at the updated amount?",
  confirmCta = "Yes, send new agreement",
  successText = "New agreement sent. The corrected invoice will go out once it's signed.",
}: {
  stageId: string;
  /** Button label — defaults to the amount-change wording. */
  label?: string;
  /** Inline confirm prompt shown before sending. */
  confirmPrompt?: string;
  /** Confirm button text. */
  confirmCta?: string;
  /** Success message after sending. */
  successText?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<SignatureSendResult | null>(null);
  const [confirming, setConfirming] = useState(false);

  function send() {
    setResult(null);
    setConfirming(false);
    startTransition(async () => {
      const r = await sendNewAgreementForStageAction(stageId);
      setResult(r);
    });
  }

  return (
    <div className="space-y-2">
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-600 dark:text-slate-400">
            {confirmPrompt}
          </span>
          <button
            type="button"
            onClick={send}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm bg-brand text-white hover:bg-brand-hover disabled:opacity-60"
          >
            {pending ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Sending…
              </>
            ) : (
              confirmCta
            )}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={pending}
            className="text-xs text-slate-500 dark:text-slate-400 hover:underline"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-900 disabled:opacity-60"
        >
          <FileSignature size={14} /> {label}
        </button>
      )}

      {result?.ok && (
        <p className="inline-flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-2">
          <Check size={12} /> {successText}
        </p>
      )}
      {result && !result.ok && (
        <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">
          {result.error}
        </p>
      )}
    </div>
  );
}

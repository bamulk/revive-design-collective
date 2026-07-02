"use client";

import { useState, useTransition } from "react";
import { Loader2, Send, Check } from "lucide-react";
import {
  resendSignatureForStageAction,
  type SignatureSendResult,
} from "@/app/(app)/stages/actions";

/**
 * Calls the server action, surfaces the result inline. Without this, a
 * failure (no client email, API key wrong, SignatureAPI rejecting the
 * payload) was silent — the button posted, the action swallowed the
 * error, the page reloaded looking unchanged.
 */
export default function SignatureSendButton({
  stageId,
  alreadySent,
}: {
  stageId: string;
  alreadySent: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<SignatureSendResult | null>(null);

  function onClick() {
    setResult(null);
    startTransition(async () => {
      const r = await resendSignatureForStageAction(stageId);
      setResult(r);
    });
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm ${
          alreadySent
            ? "border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-900"
            : "bg-slate-900 text-white hover:bg-slate-800"
        } disabled:opacity-60`}
      >
        {pending ? (
          <>
            <Loader2 size={14} className="animate-spin" /> Sending…
          </>
        ) : (
          <>
            <Send size={14} />{" "}
            {alreadySent ? "Resend signature request" : "Send for signature"}
          </>
        )}
      </button>

      {result?.ok && (
        <p className="inline-flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-2">
          <Check size={12} /> Signature request sent.
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

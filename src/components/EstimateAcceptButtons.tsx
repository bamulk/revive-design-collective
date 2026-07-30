"use client";

import { useState, useTransition } from "react";
import { Loader2, Check, X } from "lucide-react";
import {
  acceptEstimateByToken,
  declineEstimateByToken,
  type EstimateActionResult,
} from "@/app/e/[token]/actions";

export default function EstimateAcceptButtons({ token }: { token: string }) {
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [result, setResult] = useState<EstimateActionResult | null>(null);

  function onAccept() {
    if (
      !confirm(
        "Accept this estimate? We'll email you the staging agreement to sign next — your stage is confirmed once it's signed."
      )
    )
      return;
    setBusy("accept");
    setResult(null);
    startTransition(async () => {
      const r = await acceptEstimateByToken(token);
      setResult(r);
      setBusy(null);
    });
  }
  function onDecline() {
    if (!confirm("Decline this estimate?")) return;
    setBusy("decline");
    setResult(null);
    startTransition(async () => {
      const r = await declineEstimateByToken(token);
      setResult(r);
      setBusy(null);
    });
  }

  // After a successful accept/decline, the page revalidates and the
  // parent will render the "Accepted"/"Declined" badge and message
  // instead of these buttons.
  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row gap-2">
        <button
          type="button"
          onClick={onAccept}
          disabled={pending}
          className="inline-flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-60"
        >
          {busy === "accept" ? (
            <>
              <Loader2 size={14} className="animate-spin" /> Accepting…
            </>
          ) : (
            <>
              <Check size={14} /> Accept estimate
            </>
          )}
        </button>
        <button
          type="button"
          onClick={onDecline}
          disabled={pending}
          className="inline-flex items-center justify-center gap-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-900 text-slate-800 dark:text-slate-200 rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-60"
        >
          {busy === "decline" ? (
            <>
              <Loader2 size={14} className="animate-spin" /> Declining…
            </>
          ) : (
            <>
              <X size={14} /> Decline
            </>
          )}
        </button>
      </div>
      {result && !result.ok && (
        <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">
          {result.error}
        </p>
      )}
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { Loader2, Check, X, ArrowLeft } from "lucide-react";
import {
  acceptEstimateByToken,
  declineEstimateByToken,
  type EstimateActionResult,
} from "@/app/e/[token]/actions";

/**
 * Accept / Decline controls on the public estimate page.
 *
 * Confirmation is an INLINE two-step (tap → button row swaps to a
 * confirm state) — NOT window.confirm(). In-app email browsers (Gmail,
 * Outlook, etc.) routinely suppress browser dialogs, which made the
 * Accept tap silently do nothing: the client believed they'd accepted
 * ("I signed it") while our system never got the call (715 Lake Front,
 * 2026-07-27). Inline UI can't be swallowed by a webview.
 */
export default function EstimateAcceptButtons({ token }: { token: string }) {
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [armed, setArmed] = useState<"accept" | "decline" | null>(null);
  const [result, setResult] = useState<EstimateActionResult | null>(null);

  function run(kind: "accept" | "decline") {
    setBusy(kind);
    setResult(null);
    startTransition(async () => {
      const r =
        kind === "accept"
          ? await acceptEstimateByToken(token)
          : await declineEstimateByToken(token);
      setResult(r);
      setBusy(null);
      if (r.ok) setArmed(null);
    });
  }

  // After a successful accept/decline, the page revalidates and the
  // parent will render the "Accepted"/"Declined" badge and message
  // instead of these buttons.

  if (armed === "accept") {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-950/30 p-3 text-sm text-emerald-900 dark:text-emerald-100">
          Accept this estimate? We&rsquo;ll email you the staging agreement to
          sign next — your stage is confirmed once it&rsquo;s signed.
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            onClick={() => run("accept")}
            disabled={pending}
            className="inline-flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-60"
          >
            {busy === "accept" ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Accepting…
              </>
            ) : (
              <>
                <Check size={14} /> Yes — accept estimate
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => setArmed(null)}
            disabled={pending}
            className="inline-flex items-center justify-center gap-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-60"
          >
            <ArrowLeft size={14} /> Back
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

  if (armed === "decline") {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/40 p-3 text-sm text-slate-700 dark:text-slate-300">
          Decline this estimate? We&rsquo;ll mark it declined — reach out
          anytime if you change your mind.
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            onClick={() => run("decline")}
            disabled={pending}
            className="inline-flex items-center justify-center gap-1.5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-60"
          >
            {busy === "decline" ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Declining…
              </>
            ) : (
              <>
                <X size={14} /> Yes — decline
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => setArmed(null)}
            disabled={pending}
            className="inline-flex items-center justify-center gap-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-60"
          >
            <ArrowLeft size={14} /> Back
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

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row gap-2">
        <button
          type="button"
          onClick={() => {
            setResult(null);
            setArmed("accept");
          }}
          disabled={pending}
          className="inline-flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-60"
        >
          <Check size={14} /> Accept estimate
        </button>
        <button
          type="button"
          onClick={() => {
            setResult(null);
            setArmed("decline");
          }}
          disabled={pending}
          className="inline-flex items-center justify-center gap-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-900 text-slate-800 dark:text-slate-200 rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-60"
        >
          <X size={14} /> Decline
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

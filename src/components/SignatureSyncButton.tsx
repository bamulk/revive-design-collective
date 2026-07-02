"use client";

import { useState, useTransition } from "react";
import { Loader2, RefreshCw, CheckCircle } from "lucide-react";
import {
  syncSignatureStatusAction,
  markSignatureSignedAction,
  type SignatureSyncResult,
} from "@/app/(app)/stages/actions";

/**
 * Two recovery actions when webhooks miss or SignatureAPI lags:
 *
 * 1. "Sync status" — re-reads the envelope from SignatureAPI and writes
 *    the current status to the stage. Also surfaces the live envelope
 *    + recipient statuses so you can see why things look stuck.
 * 2. "Mark as signed" — admin-only override that flips the stage to
 *    signed locally regardless of what SignatureAPI reports.
 */
export default function SignatureSyncButton({
  stageId,
  isAdmin = false,
}: {
  stageId: string;
  isAdmin?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"sync" | "mark" | null>(null);
  const [result, setResult] = useState<SignatureSyncResult | null>(null);

  function onSync() {
    setResult(null);
    setBusy("sync");
    startTransition(async () => {
      const r = await syncSignatureStatusAction(stageId);
      setResult(r);
      setBusy(null);
    });
  }

  function onMark() {
    if (
      !confirm(
        "Mark this stage as signed manually? Use this only when you've confirmed signing out-of-band."
      )
    )
      return;
    setResult(null);
    setBusy("mark");
    startTransition(async () => {
      const r = await markSignatureSignedAction(stageId);
      setResult(r);
      setBusy(null);
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onSync}
          disabled={pending}
          className="inline-flex items-center gap-1.5 text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-900 disabled:opacity-60"
        >
          {busy === "sync" ? (
            <>
              <Loader2 size={14} className="animate-spin" /> Syncing…
            </>
          ) : (
            <>
              <RefreshCw size={14} /> Sync status
            </>
          )}
        </button>
        {isAdmin && (
          <button
            type="button"
            onClick={onMark}
            disabled={pending}
            className="inline-flex items-center gap-1.5 text-sm border border-emerald-200 text-emerald-700 rounded-lg px-3 py-2 hover:bg-emerald-50 disabled:opacity-60"
          >
            {busy === "mark" ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Marking…
              </>
            ) : (
              <>
                <CheckCircle size={14} /> Mark as signed
              </>
            )}
          </button>
        )}
      </div>

      {result?.ok && (
        <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-2 space-y-1">
          <div>
            Status: <strong>{result.status}</strong>
            {result.envelopeStatus &&
              result.envelopeStatus !== result.status && (
                <> · envelope: <strong>{result.envelopeStatus}</strong></>
              )}
          </div>
          {result.recipients && result.recipients.length > 0 && (
            <ul className="space-y-0.5">
              {result.recipients.map((r, i) => (
                <li key={i}>
                  {r.email || "(no email)"} →{" "}
                  <strong>{r.status || "?"}</strong>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {result && !result.ok && (
        <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">
          {result.error}
        </p>
      )}
    </div>
  );
}

"use client";

import { useRef, useState, useTransition } from "react";
import { Loader2, Upload, Check } from "lucide-react";
import {
  attachSignedPdfAction,
  type AttachPdfResult,
} from "@/app/(app)/stages/actions";

/**
 * Admin-only fallback for attaching a signed PDF when the automatic
 * download from SignatureAPI didn't run (missed webhook, mismatched
 * envelope id, or out-of-band signing).
 */
export default function SignedPdfUploader({
  stageId,
  hasExisting,
}: {
  stageId: string;
  hasExisting: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<AttachPdfResult | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const file = inputRef.current?.files?.[0];
    if (!file) {
      setResult({ ok: false, error: "Pick a PDF first" });
      return;
    }
    const fd = new FormData();
    fd.set("file", file);
    setResult(null);
    startTransition(async () => {
      const r = await attachSignedPdfAction(stageId, fd);
      setResult(r);
      if (r.ok && inputRef.current) inputRef.current.value = "";
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <label className="text-xs text-slate-600 dark:text-slate-400">
        {hasExisting
          ? "Replace the signed PDF on this stage"
          : "Upload a signed PDF (admin)"}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="text-sm file:mr-3 file:px-3 file:py-1.5 file:rounded-md file:border-0 file:bg-slate-900 file:text-white"
        />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-1.5 text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-900 disabled:opacity-60"
        >
          {pending ? (
            <>
              <Loader2 size={14} className="animate-spin" /> Uploading…
            </>
          ) : (
            <>
              <Upload size={14} /> {hasExisting ? "Replace" : "Attach PDF"}
            </>
          )}
        </button>
      </div>
      {result?.ok && (
        <p className="inline-flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-2">
          <Check size={12} /> PDF attached.
        </p>
      )}
      {result && !result.ok && (
        <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">
          {result.error}
        </p>
      )}
    </form>
  );
}

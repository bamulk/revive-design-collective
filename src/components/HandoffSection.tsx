"use client";

import { useState, useTransition } from "react";
import { RefreshCw, Copy, Check, Loader2, ArrowRightLeft } from "lucide-react";
import { resendHandoffEmailAction } from "@/app/(app)/stages/actions";

/**
 * Stage-detail Handoff card. An agent who doesn't want responsibility for
 * a stage can pass it to the seller via a public link. This shows whether
 * that happened, and lets staff resend or copy the link on request.
 */
export default function HandoffSection({
  stageId,
  agentName,
  handoffToken,
  sellerName,
  sellerEmail,
  completedAt,
}: {
  stageId: string;
  agentName: string | null;
  handoffToken: string | null;
  sellerName: string | null;
  sellerEmail: string | null;
  completedAt: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const decided = !!completedAt;
  const handedOff = !!(sellerEmail && completedAt);

  function resend() {
    setMsg(null);
    startTransition(async () => {
      const r = await resendHandoffEmailAction(stageId);
      setMsg(r.ok ? "Choice email sent to the agent." : r.error || "Failed.");
    });
  }

  function copyLink() {
    if (!handoffToken) return;
    const url = `${window.location.origin}/handoff/${handoffToken}`;
    navigator.clipboard?.writeText(url).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => setMsg("Couldn't copy — copy it manually."),
    );
  }

  return (
    <section className="bg-white dark:bg-slate-900 border rounded-xl p-5 space-y-3">
      <div className="flex items-center gap-2">
        <ArrowRightLeft size={15} className="text-slate-500" />
        <h2 className="font-medium">Signer</h2>
      </div>

      {decided && !handedOff ? (
        <div className="text-sm text-slate-700 dark:text-slate-300 space-y-1">
          <p className="font-medium text-slate-900 dark:text-slate-100">
            {agentName ?? "The agent"} is signing
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            They kept it — the agreement and invoice go to them.
          </p>
        </div>
      ) : handedOff ? (
        <div className="text-sm text-slate-700 dark:text-slate-300 space-y-1">
          <p>
            {agentName ?? "The agent"} passed this stage to the seller:
          </p>
          <p className="font-medium text-slate-900 dark:text-slate-100">
            {sellerName}{" "}
            <span className="font-normal text-slate-500 dark:text-slate-400">
              &lt;{sellerEmail}&gt;
            </span>
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            The agreement and invoice go to the seller.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-slate-700 dark:text-slate-300">
            Waiting on {agentName ?? "the agent"} to choose who signs — them or
            their seller. <strong>No agreement has been sent yet.</strong>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={resend}
              disabled={pending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60"
            >
              {pending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RefreshCw size={14} />
              )}
              Resend choice email
            </button>
            {handoffToken && (
              <button
                type="button"
                onClick={copyLink}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? "Copied" : "Copy choice link"}
              </button>
            )}
          </div>
        </div>
      )}

      {msg && (
        <p className="text-xs text-slate-500 dark:text-slate-400">{msg}</p>
      )}
    </section>
  );
}

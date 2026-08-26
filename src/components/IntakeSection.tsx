"use client";

import { useState, useTransition } from "react";
import { RefreshCw, Copy, Check, Loader2 } from "lucide-react";
import { resendIntakeEmailAction } from "@/app/(app)/stages/actions";

/**
 * Stage-detail Intake card. Shows where the realtor-intake flow stands:
 * either the homeowner has been submitted, or we're still waiting on the
 * realtor to fill in the form. While waiting, admins can resend the email
 * or copy the intake link.
 */
export default function IntakeSection({
  stageId,
  agentName,
  intakeToken,
  homeownerName,
  homeownerEmail,
  completedAt,
}: {
  stageId: string;
  agentName: string | null;
  intakeToken: string | null;
  homeownerName: string | null;
  homeownerEmail: string | null;
  completedAt: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const submitted = !!(homeownerEmail && completedAt);

  function resend() {
    setMsg(null);
    startTransition(async () => {
      const r = await resendIntakeEmailAction(stageId);
      setMsg(r.ok ? "Intake email sent." : r.error || "Failed to send.");
    });
  }

  function copyLink() {
    if (!intakeToken) return;
    const url = `${window.location.origin}/intake/${intakeToken}`;
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
      <h2 className="font-medium">Intake</h2>

      {submitted ? (
        <div className="text-sm text-slate-700 dark:text-slate-300 space-y-1">
          <p>
            Homeowner submitted by {agentName ?? "the realtor"}:
          </p>
          <p className="font-medium text-slate-900 dark:text-slate-100">
            {homeownerName}{" "}
            <span className="font-normal text-slate-500 dark:text-slate-400">
              &lt;{homeownerEmail}&gt;
            </span>
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            The agreement and invoice go to the homeowner.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-slate-700 dark:text-slate-300">
            Waiting on {agentName ?? "the realtor"} to enter the homeowner&rsquo;s
            details. They were emailed a link to the intake form.
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
              Resend intake email
            </button>
            {intakeToken && (
              <button
                type="button"
                onClick={copyLink}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? "Copied" : "Copy intake link"}
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

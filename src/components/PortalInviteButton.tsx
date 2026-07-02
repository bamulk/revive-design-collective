"use client";

import { useState, useTransition } from "react";
import { Mail, Check, Loader2 } from "lucide-react";
import { sendPortalLinkAction } from "@/app/(app)/clients/actions";

/**
 * Admin button on the client page: emails the client a magic-link
 * sign-in for the portal. Shows pending/success/error inline so the
 * admin sees confirmation without leaving the page.
 */
export default function PortalInviteButton({
  clientId,
  hasEmail,
}: {
  clientId: string;
  hasEmail: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<
    { ok: true; email: string } | { ok: false; error: string } | null
  >(null);

  function send() {
    setResult(null);
    startTransition(async () => {
      const res = await sendPortalLinkAction(clientId);
      setResult(res);
    });
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <button
        type="button"
        onClick={send}
        disabled={pending || !hasEmail}
        title={hasEmail ? "Email a portal sign-in link" : "Add an email to the client first"}
        className="inline-flex items-center gap-1.5 text-sm bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {pending ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <Mail size={14} />
        )}
        Send portal link
      </button>
      {result?.ok && (
        <span className="inline-flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-300">
          <Check size={14} /> Sent to {result.email}
        </span>
      )}
      {result && !result.ok && (
        <span className="text-sm text-rose-700 dark:text-rose-300">
          {result.error}
        </span>
      )}
    </div>
  );
}

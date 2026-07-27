"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  Copy,
  Check,
  RefreshCw,
  Loader2,
  Trash2,
  Mail,
  MessageSquare,
  Send,
  Pencil,
  ChevronDown,
  CircleAlert,
} from "lucide-react";
import {
  regenerateEstimateTokenAction,
  deleteEstimateAction,
  sendEstimateEmailAction,
} from "@/app/(app)/estimates/actions";
import { useRouter } from "next/navigation";

/**
 * Admin UI for sharing an estimate with a client. Primary action is
 * "Send email" — sends a branded Resend email to the client (BCC's
 * admins) and stamps estimate_sent_at. The mailto link + SMS link
 * are kept as manual fallbacks.
 */
export default function EstimateShareLink({
  stageId,
  token,
  url,
  clientEmail,
  clientPhone,
  sentAt,
}: {
  stageId: string;
  token: string;
  url: string;
  clientEmail: string | null;
  clientPhone: string | null;
  sentAt: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"regen" | "delete" | "send" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sentToast, setSentToast] = useState<string | null>(null);
  const router = useRouter();

  function sendEmailViaResend() {
    // Guard against accidental duplicates — the estimate auto-sends on
    // creation, so an already-sent one deserves an "are you sure".
    if (
      sentAt &&
      !confirm(
        `This estimate was already emailed on ${new Date(
          sentAt,
        ).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          timeZone: "America/Los_Angeles",
        })}. Send it again?`,
      )
    ) {
      return;
    }
    setError(null);
    setSentToast(null);
    setBusy("send");
    startTransition(async () => {
      const r = await sendEstimateEmailAction(stageId);
      setBusy(null);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setSentToast("Estimate emailed to client.");
      router.refresh();
    });
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't access the clipboard. Long-press the link to copy.");
    }
  }

  function regenerate() {
    if (
      !confirm(
        "Generate a fresh link? The current one will stop working immediately."
      )
    )
      return;
    setError(null);
    setBusy("regen");
    startTransition(async () => {
      const r = await regenerateEstimateTokenAction(stageId);
      if (!r.ok) setError(r.error);
      setBusy(null);
    });
  }

  function deleteEstimate() {
    if (
      !confirm(
        "Delete this estimate? Use this if you sent it by mistake or want to start over."
      )
    )
      return;
    setError(null);
    setBusy("delete");
    startTransition(async () => {
      const r = await deleteEstimateAction(stageId);
      if (!r.ok) {
        setError(r.error);
        setBusy(null);
        return;
      }
      router.push("/estimates");
    });
  }

  const mailto = clientEmail
    ? `mailto:${encodeURIComponent(clientEmail)}?subject=${encodeURIComponent(
        "Your Revive Design Collective estimate"
      )}&body=${encodeURIComponent(
        `Hi,\n\nHere's your staging estimate — please review and accept or decline:\n\n${url}\n\nThanks!\nRevive Design Collective`
      )}`
    : `mailto:?subject=${encodeURIComponent(
        "Your Revive Design Collective estimate"
      )}&body=${encodeURIComponent(
        `Hi,\n\nHere's your staging estimate — please review and accept or decline:\n\n${url}\n\nThanks!\nRevive Design Collective`
      )}`;

  // sms: URI. Phones treat the body separator inconsistently — iOS
  // historically wants `&body=`, Android wants `?body=`. Modern OSes
  // accept both, but using `?` for the first separator after the
  // number is the safer bet.
  const smsBody = encodeURIComponent(
    `Revive Design Collective estimate — review & accept here: ${url}`
  );
  const smsNumber = clientPhone ? clientPhone.replace(/[^\d+]/g, "") : "";
  const smsHref = smsNumber
    ? `sms:${smsNumber}?body=${smsBody}`
    : `sms:?body=${smsBody}`;

  // Format the "sent on" date once. Falls back to the raw ISO if we
  // somehow get an unexpected shape.
  const sentDateLabel = (() => {
    if (!sentAt) return null;
    const m = String(sentAt).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[2]}/${m[3]}/${m[1].slice(-2)}` : sentAt;
  })();

  const isSent = !!sentAt;
  const sendDisabled = !clientEmail || pending;

  return (
    <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-5 space-y-4">
      {/* Status header — clear "Sent" or "Ready to send" callout */}
      {isSent ? (
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 inline-flex items-center justify-center w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 shrink-0">
            <Check size={16} />
          </span>
          <div className="min-w-0">
            <div className="font-medium text-slate-900 dark:text-slate-100">
              Estimate sent
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {clientEmail ? (
                <>
                  Emailed to{" "}
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    {clientEmail}
                  </span>{" "}
                  on {sentDateLabel}
                </>
              ) : (
                <>Sent on {sentDateLabel}</>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 inline-flex items-center justify-center w-8 h-8 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300 shrink-0">
            <CircleAlert size={16} />
          </span>
          <div className="min-w-0">
            <div className="font-medium text-slate-900 dark:text-slate-100">
              Ready to send
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {clientEmail
                ? `Will email ${clientEmail}.`
                : "No email on file — copy the link or open in Mail app below."}
            </div>
          </div>
        </div>
      )}

      {/* Primary actions: Send/Resend, Edit, Copy link. */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={sendEmailViaResend}
          disabled={sendDisabled}
          title={
            clientEmail
              ? isSent
                ? "Resend the branded estimate email"
                : "Send a branded estimate email"
              : "No email on file for this client"
          }
          className="inline-flex items-center gap-1.5 text-sm bg-brand text-white rounded-lg px-3 py-2 hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy === "send" ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              {isSent ? "Resending…" : "Sending…"}
            </>
          ) : (
            <>
              <Send size={14} /> {isSent ? "Resend" : "Send email"}
            </>
          )}
        </button>
        <Link
          href={`/estimates/${stageId}/edit`}
          className="inline-flex items-center gap-1.5 text-sm border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          <Pencil size={14} /> Edit
        </Link>
        <button
          type="button"
          onClick={copyLink}
          className="inline-flex items-center gap-1.5 text-sm border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          {copied ? (
            <>
              <Check size={14} /> Link copied
            </>
          ) : (
            <>
              <Copy size={14} /> Copy link
            </>
          )}
        </button>
      </div>

      {/* Tucked-away secondary actions for the edge cases. */}
      <details className="group [&_summary]:list-none">
        <summary className="cursor-pointer inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
          <ChevronDown
            size={12}
            className="transition-transform group-open:rotate-180"
          />
          More options
        </summary>
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={mailto}
              className="inline-flex items-center gap-1.5 text-xs border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-900"
            >
              <Mail size={12} />{" "}
              {clientEmail ? "Open in Mail app" : "Open in Mail app (no address)"}
            </a>
            <a
              href={smsHref}
              className="inline-flex items-center gap-1.5 text-xs border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-900"
            >
              <MessageSquare size={12} />{" "}
              {clientPhone ? "Text via SMS" : "Text (no phone)"}
            </a>
            <button
              type="button"
              onClick={regenerate}
              disabled={pending}
              className="inline-flex items-center gap-1.5 text-xs border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-900 disabled:opacity-60"
            >
              {busy === "regen" ? (
                <>
                  <Loader2 size={12} className="animate-spin" /> Regenerating…
                </>
              ) : (
                <>
                  <RefreshCw size={12} /> New link
                </>
              )}
            </button>
            <button
              type="button"
              onClick={deleteEstimate}
              disabled={pending}
              className="inline-flex items-center gap-1.5 text-xs border border-rose-200 text-rose-700 rounded-lg px-2.5 py-1.5 hover:bg-rose-50 disabled:opacity-60 ml-auto"
            >
              {busy === "delete" ? (
                <>
                  <Loader2 size={12} className="animate-spin" /> Deleting…
                </>
              ) : (
                <>
                  <Trash2 size={12} /> Delete estimate
                </>
              )}
            </button>
          </div>
          {/* Raw URL for manual share — handy when "Copy link" can't
              access the clipboard (e.g. older mobile browsers). */}
          <div className="text-[11px] text-slate-500 dark:text-slate-400 break-all font-mono select-all bg-slate-50 dark:bg-slate-800/50 rounded px-2 py-1.5">
            {url}
          </div>
        </div>
      </details>

      {error && (
        <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">
          {error}
        </p>
      )}
      {sentToast && (
        <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded p-2 inline-flex items-center gap-1.5">
          <Check size={12} /> {sentToast}
        </p>
      )}
    </section>
  );
}

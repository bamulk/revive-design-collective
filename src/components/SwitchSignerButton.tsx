"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, Check, Loader2 } from "lucide-react";
import {
  setStageSellerAction,
  returnStageToAgentAction,
  type SignerSwitchResult,
} from "@/app/(app)/stages/actions";

/**
 * Signature-card override for who signs + pays. The agent normally
 * decides via their emailed link; this lets staff make (or reverse)
 * that call — e.g. the agent kept a stage that should have gone to the
 * seller. Switching always sends the new signer a fresh agreement, and
 * the invoice follows them once they sign. Two-step, since it emails a
 * client and supersedes whatever agreement is already out.
 */
export default function SwitchSignerButton({
  stageId,
  agentName,
  sellerName,
  sellerEmail,
  isSigned,
}: {
  stageId: string;
  agentName: string | null;
  /** Current seller override, if the stage is already handed off. */
  sellerName: string | null;
  sellerEmail: string | null;
  /** An agreement is already signed — switching replaces it. */
  isSigned: boolean;
}) {
  const handedOff = !!(sellerName && sellerEmail);
  const [mode, setMode] = useState<null | "seller" | "agent">(null);
  const [name, setName] = useState(sellerName ?? "");
  const [email, setEmail] = useState(sellerEmail ?? "");
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const agent = agentName ?? "the agent";

  function finish(r: SignerSwitchResult, who: string) {
    if (!r.ok) {
      setMsg({ tone: "err", text: r.error });
      setConfirming(false);
      return;
    }
    setMode(null);
    setConfirming(false);
    setMsg(
      r.agreementSent
        ? { tone: "ok", text: `Signer changed — new agreement sent to ${who}.` }
        : {
            tone: "err",
            text: `Signer changed to ${who}, but the agreement didn't send: ${r.sendError ?? "unknown error"}. Use "Send updated agreement" to retry.`,
          },
    );
    router.refresh();
  }

  function submitSeller(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!confirming) {
      setConfirming(true);
      return;
    }
    startTransition(async () => {
      finish(
        await setStageSellerAction(stageId, { sellerName: name, sellerEmail: email }),
        email.trim(),
      );
    });
  }

  function submitAgent() {
    setMsg(null);
    if (!confirming) {
      setConfirming(true);
      return;
    }
    startTransition(async () => {
      finish(await returnStageToAgentAction(stageId), agent);
    });
  }

  const btn =
    "inline-flex items-center gap-1.5 text-xs border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 rounded-lg px-2.5 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300";
  const field =
    "w-full border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 text-base bg-white dark:bg-slate-900";
  const go =
    "inline-flex items-center gap-1 text-[11px] font-semibold text-white bg-slate-900 dark:bg-white dark:text-slate-900 px-2.5 py-1 rounded-full disabled:opacity-50";
  const cancel =
    "text-[11px] font-medium text-slate-700 dark:text-slate-300 px-2 py-1 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-60";

  const signedWarning = isSigned ? (
    <p className="text-amber-800 dark:text-amber-200">
      An agreement is already signed for this stage. Switching replaces it —
      the new signer has to sign a fresh one.
    </p>
  ) : null;

  function close() {
    setMode(null);
    setConfirming(false);
  }

  return (
    <div className="space-y-1.5">
      {mode === null && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setMode("seller");
              setMsg(null);
            }}
            className={btn}
          >
            <ArrowRightLeft size={12} />
            {handedOff ? "Change seller" : "Change signer to seller"}
          </button>
          {handedOff && (
            <button
              type="button"
              onClick={() => {
                setMode("agent");
                setMsg(null);
              }}
              className={btn}
            >
              <ArrowRightLeft size={12} /> Switch back to {agent}
            </button>
          )}
        </div>
      )}

      {mode === "seller" && (
        <form
          onSubmit={submitSeller}
          className="rounded-lg bg-slate-50 dark:bg-slate-800/70 ring-1 ring-slate-200 dark:ring-slate-700 p-3 space-y-2 text-xs text-slate-700 dark:text-slate-300 max-w-md"
        >
          <p className="font-medium">
            {handedOff ? "Change the seller" : "Make the seller the signer"}
          </p>
          <p>
            The seller signs and pays instead of {agent}. {agent === "the agent" ? "The agent" : agent}{" "}
            stays on the stage as the client of record.
          </p>
          <input
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setConfirming(false);
            }}
            placeholder="Seller / homeowner name"
            autoComplete="off"
            required
            className={field}
          />
          <input
            type="email"
            inputMode="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setConfirming(false);
            }}
            placeholder="seller@example.com"
            autoComplete="off"
            required
            className={field}
          />
          {signedWarning}
          {confirming && (
            <p className="text-amber-800 dark:text-amber-200 break-all">
              Send a new agreement to <strong>{email.trim()}</strong>? Any
              agreement already out stops counting, and the invoice goes to the
              seller once they sign.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <button type="submit" disabled={pending} className={go}>
              {pending ? (
                <>
                  <Loader2 size={11} className="animate-spin" /> Sending…
                </>
              ) : confirming ? (
                "Yes — send it to the seller"
              ) : (
                "Send agreement to seller"
              )}
            </button>
            <button type="button" onClick={close} disabled={pending} className={cancel}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {mode === "agent" && (
        <div className="rounded-lg bg-slate-50 dark:bg-slate-800/70 ring-1 ring-slate-200 dark:ring-slate-700 p-3 space-y-2 text-xs text-slate-700 dark:text-slate-300 max-w-md">
          <p className="font-medium">Switch the signer back to {agent}?</p>
          <p>
            {sellerName} is removed as the signer. {agent} gets a new agreement
            to sign, and the invoice goes to them once it&rsquo;s signed.
          </p>
          {signedWarning}
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <button type="button" onClick={submitAgent} disabled={pending} className={go}>
              {pending ? (
                <>
                  <Loader2 size={11} className="animate-spin" /> Sending…
                </>
              ) : confirming ? (
                `Yes — send it to ${agent}`
              ) : (
                "Switch back"
              )}
            </button>
            <button type="button" onClick={close} disabled={pending} className={cancel}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {msg && (
        <p
          className={`text-xs inline-flex items-start gap-1 ${
            msg.tone === "ok"
              ? "text-emerald-700 dark:text-emerald-300"
              : "text-rose-700 dark:text-rose-300"
          }`}
        >
          {msg.tone === "ok" && <Check size={12} className="mt-0.5 shrink-0" />}
          {msg.text}
        </p>
      )}
    </div>
  );
}

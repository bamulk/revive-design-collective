"use client";

import { useEffect, useState, useTransition } from "react";
import { PenLine, Send } from "lucide-react";
import { keepForSelfAction, submitHandoffAction } from "./actions";

type Choice = "self" | "seller" | null;

/**
 * Signer chooser. Nothing has been sent when this renders — whichever
 * option the agent picks decides who gets the agreement and the invoice.
 * The pick always needs an explicit click here (never a bare link in the
 * email), so a link-prefetching mail scanner can't decide for them.
 */
export default function HandoffForm({ token }: { token: string }) {
  const [choice, setChoice] = useState<Choice>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"self" | "seller" | null>(null);
  const [pending, startTransition] = useTransition();

  // The email's two buttons land here with #self / #seller so the
  // matching option is already open — but still unsubmitted.
  useEffect(() => {
    const h = window.location.hash.replace("#", "");
    if (h === "self" || h === "seller") setChoice(h);
  }, []);

  function keepIt() {
    setError(null);
    if (!confirming) {
      setConfirming(true);
      return;
    }
    startTransition(async () => {
      const r = await keepForSelfAction(token);
      if (r.ok) setDone("self");
      else {
        setError(r.error);
        setConfirming(false);
      }
    });
  }

  function sendToSeller(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!confirming) {
      setConfirming(true);
      return;
    }
    startTransition(async () => {
      const r = await submitHandoffAction({
        token,
        sellerName: name,
        sellerEmail: email,
      });
      if (r.ok) setDone("seller");
      else {
        setError(r.error);
        setConfirming(false);
      }
    });
  }

  if (done) {
    return (
      <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/30 p-4">
        <p className="font-medium text-emerald-800 dark:text-emerald-200">
          {done === "self" ? "You're all set." : "Sent — you're all set."}
        </p>
        <p className="text-sm text-emerald-700 dark:text-emerald-300 mt-1">
          {done === "self" ? (
            <>
              The staging agreement is on its way to your inbox. Your invoice
              follows once it&rsquo;s signed.
            </>
          ) : (
            <>
              We&rsquo;ve sent the agreement to <strong>{name}</strong>. They
              sign it and receive the invoice &mdash; nothing further is needed
              from you.
            </>
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Option 1 — the agent signs */}
      <div
        className={`rounded-lg border p-4 ${
          choice === "self"
            ? "border-slate-400 dark:border-slate-500 bg-slate-50 dark:bg-slate-800/50"
            : "border-slate-200 dark:border-slate-700"
        }`}
      >
        <button
          type="button"
          onClick={() => {
            setChoice("self");
            setConfirming(false);
            setError(null);
          }}
          className="w-full text-left"
        >
          <div className="flex items-start gap-3">
            <PenLine size={18} className="mt-0.5 text-slate-500 shrink-0" />
            <div>
              <div className="font-medium text-slate-900 dark:text-slate-100">
                I&rsquo;ll sign it myself
              </div>
              <div className="text-sm text-slate-600 dark:text-slate-400">
                You receive the agreement and the invoice.
              </div>
            </div>
          </div>
        </button>

        {choice === "self" && (
          <div className="mt-3 space-y-3">
            {confirming && !error && (
              <p className="text-sm text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                Send the agreement to you? You&rsquo;ll be responsible for
                signing and payment.
              </p>
            )}
            <button
              type="button"
              onClick={keepIt}
              disabled={pending}
              className="w-full sm:w-auto inline-flex items-center justify-center px-5 py-2.5 rounded-lg text-white font-medium disabled:opacity-60"
              style={{ background: "var(--brand)" }}
            >
              {pending
                ? "Sending…"
                : confirming
                  ? "Yes, send it to me"
                  : "Send the agreement to me"}
            </button>
          </div>
        )}
      </div>

      {/* Option 2 — the seller signs */}
      <div
        className={`rounded-lg border p-4 ${
          choice === "seller"
            ? "border-slate-400 dark:border-slate-500 bg-slate-50 dark:bg-slate-800/50"
            : "border-slate-200 dark:border-slate-700"
        }`}
      >
        <button
          type="button"
          onClick={() => {
            setChoice("seller");
            setConfirming(false);
            setError(null);
          }}
          className="w-full text-left"
        >
          <div className="flex items-start gap-3">
            <Send size={18} className="mt-0.5 text-slate-500 shrink-0" />
            <div>
              <div className="font-medium text-slate-900 dark:text-slate-100">
                Send it to my seller
              </div>
              <div className="text-sm text-slate-600 dark:text-slate-400">
                They sign and pay &mdash; you stay on as the referring agent.
              </div>
            </div>
          </div>
        </button>

        {choice === "seller" && (
          <form onSubmit={sendToSeller} className="mt-3 space-y-3">
            <div>
              <label className="block text-sm font-medium text-slate-900 dark:text-slate-100 mb-1">
                Seller / homeowner name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setConfirming(false);
                }}
                placeholder="Jane Seller"
                autoComplete="name"
                className="w-full border rounded-lg px-3 py-2.5 text-base"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-900 dark:text-slate-100 mb-1">
                Seller / homeowner email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setConfirming(false);
                }}
                placeholder="jane@example.com"
                autoComplete="email"
                inputMode="email"
                className="w-full border rounded-lg px-3 py-2.5 text-base"
                required
              />
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                The agreement and the invoice both go to this address.
              </p>
            </div>

            {confirming && !error && (
              <p className="text-sm text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                Send this staging to <strong>{name || "the seller"}</strong>?
                They become responsible for signing and payment.
              </p>
            )}
            <button
              type="submit"
              disabled={pending}
              className="w-full sm:w-auto inline-flex items-center justify-center px-5 py-2.5 rounded-lg text-white font-medium disabled:opacity-60"
              style={{ background: "var(--brand)" }}
            >
              {pending
                ? "Sending…"
                : confirming
                  ? "Yes, send it to them"
                  : "Send to the seller"}
            </button>
          </form>
        )}
      </div>

      {error && (
        <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>
      )}
    </div>
  );
}

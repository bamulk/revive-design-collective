"use client";

import { useState, useTransition } from "react";
import { submitHandoffAction } from "./actions";

export default function HandoffForm({ token }: { token: string }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    // Two-step confirm — handing off is not reversible from this page.
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
      if (r.ok) setDone(true);
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
          Handed off — you&rsquo;re all set.
        </p>
        <p className="text-sm text-emerald-700 dark:text-emerald-300 mt-1">
          We&rsquo;ve sent the staging agreement to <strong>{name}</strong>. They
          sign it and receive the invoice. Nothing further is needed from you.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
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

      {error && (
        <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>
      )}

      {confirming && !error && (
        <p className="text-sm text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
          Hand this staging to <strong>{name || "the seller"}</strong>? They
          become responsible for signing and payment. This can&rsquo;t be undone
          from this page.
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
            ? "Yes, hand it off"
            : "Send to the seller"}
      </button>
    </form>
  );
}

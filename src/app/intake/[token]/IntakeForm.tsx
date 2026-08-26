"use client";

import { useState, useTransition } from "react";
import { submitIntakeAction } from "./actions";

export default function IntakeForm({ token }: { token: string }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const r = await submitIntakeAction({
        token,
        homeownerName: name,
        homeownerEmail: email,
      });
      if (r.ok) setDone(true);
      else setError(r.error);
    });
  }

  if (done) {
    return (
      <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/30 p-4">
        <p className="font-medium text-emerald-800 dark:text-emerald-200">
          Thank you — you&rsquo;re all set.
        </p>
        <p className="text-sm text-emerald-700 dark:text-emerald-300 mt-1">
          We&rsquo;ve emailed <strong>{name}</strong> the staging agreement to
          sign. Once signed, their invoice is sent automatically. You don&rsquo;t
          need to do anything else.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-900 dark:text-slate-100 mb-1">
          Homeowner name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Jane Homeowner"
          autoComplete="name"
          className="w-full border rounded-lg px-3 py-2.5 text-base"
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-900 dark:text-slate-100 mb-1">
          Homeowner email
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="jane@example.com"
          autoComplete="email"
          inputMode="email"
          className="w-full border rounded-lg px-3 py-2.5 text-base"
          required
        />
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          We&rsquo;ll send the agreement and the invoice to this address.
        </p>
      </div>

      {error && (
        <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full sm:w-auto inline-flex items-center justify-center px-5 py-2.5 rounded-lg text-white font-medium disabled:opacity-60"
        style={{ background: "var(--brand)" }}
      >
        {pending ? "Sending…" : "Send agreement to homeowner"}
      </button>
    </form>
  );
}

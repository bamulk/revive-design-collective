"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import {
  confirmExtensionAction,
  confirmDestageAction,
  type ExtensionResult,
} from "./actions";

/**
 * The two big buttons on /x/[token].
 *
 * Each click is gated by a confirm() prompt so the client can't
 * burn the token by accident on a fat-fingered tap. After either
 * action succeeds, the page revalidates and the parent server
 * component re-renders in its "decided" state.
 */
export default function ExtensionActions({ token }: { token: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ExtensionResult | null>(null);

  function onExtend() {
    if (
      !confirm(
        "Extend staging for another 30 days? We'll send a 50% invoice and let our team know.",
      )
    ) {
      return;
    }
    setResult(null);
    startTransition(async () => {
      const r = await confirmExtensionAction(token);
      setResult(r);
    });
  }

  function onDestage() {
    if (
      !confirm(
        "Schedule destage on the existing date? We'll come pick everything up.",
      )
    ) {
      return;
    }
    setResult(null);
    startTransition(async () => {
      const r = await confirmDestageAction(token);
      setResult(r);
    });
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onExtend}
          disabled={pending}
          className="inline-flex items-center justify-center gap-2 bg-[var(--brand)] hover:bg-[var(--brand-hover)] disabled:opacity-60 text-white rounded-lg px-4 py-3 font-medium"
        >
          {pending ? <Loader2 size={16} className="animate-spin" /> : null}
          Extend 30 more days
        </button>
        <button
          type="button"
          onClick={onDestage}
          disabled={pending}
          className="inline-flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600 disabled:opacity-60 text-white rounded-lg px-4 py-3 font-medium"
        >
          {pending ? <Loader2 size={16} className="animate-spin" /> : null}
          Schedule destage
        </button>
      </div>
      {result && !result.ok && (
        <p className="text-sm text-rose-700 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 rounded-lg px-3 py-2">
          {result.error}
        </p>
      )}
    </div>
  );
}

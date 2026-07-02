"use client";

import { useState, useTransition } from "react";
import { Loader2, RefreshCw, Unlink } from "lucide-react";
import {
  syncPlaidItemAction,
  disconnectPlaidItemAction,
} from "./plaid-actions";

/**
 * Per-row action cluster on a connected bank: manual "Sync now" +
 * "Disconnect". Disconnect uses a two-step inline confirm so a stray
 * tap doesn't kill an active connection.
 */
export default function PlaidItemRowActions({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  const [confirmDisc, setConfirmDisc] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function sync() {
    setMsg(null);
    startTransition(async () => {
      const res = await syncPlaidItemAction(id);
      if (!res.ok) {
        setMsg(res.error);
        return;
      }
      const { added, modified, removed } = res.synced;
      setMsg(`Synced: +${added} new, ${modified} updated, ${removed} removed`);
    });
  }

  function disconnect() {
    if (!confirmDisc) {
      setConfirmDisc(true);
      setTimeout(() => setConfirmDisc(false), 4000);
      return;
    }
    setMsg(null);
    startTransition(async () => {
      const res = await disconnectPlaidItemAction(id);
      if (!res.ok) setMsg(res.error);
      // Server action revalidates /finance; the row disappears on refresh.
    });
  }

  return (
    <div className="flex flex-col items-end gap-1 shrink-0">
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={sync}
          disabled={pending}
          title="Pull new transactions now"
          className="inline-flex items-center gap-1 text-xs border border-slate-300 dark:border-slate-700 rounded px-2 py-1 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
        >
          {pending ? (
            <Loader2 size={11} className="animate-spin" />
          ) : (
            <RefreshCw size={11} />
          )}
          Sync
        </button>
        <button
          type="button"
          onClick={disconnect}
          disabled={pending}
          className={`inline-flex items-center gap-1 text-xs rounded px-2 py-1 disabled:opacity-50 ${
            confirmDisc
              ? "bg-rose-600 text-white"
              : "border border-rose-300 dark:border-rose-900/60 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40"
          }`}
        >
          <Unlink size={11} />
          {confirmDisc ? "Confirm" : "Disconnect"}
        </button>
      </div>
      {msg && (
        <span className="text-[11px] text-slate-600 dark:text-slate-400 max-w-[16rem] text-right">
          {msg}
        </span>
      )}
    </div>
  );
}

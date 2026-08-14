"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Mail } from "lucide-react";
import {
  batchSendMissingInvoicesAction,
  type BatchSendResult,
} from "@/app/(app)/stages/actions";

/**
 * One-tap backlog catch-up on the Outstanding invoices section: emails
 * an invoice to every unpaid stage that never had one sent. Two-step
 * inline confirm, then loops the chunked server action until nothing
 * remains (or a whole chunk fails), showing live progress. Stages whose
 * client has no email on file are skipped server-side.
 */
export default function BatchSendInvoicesButton({
  eligibleCount,
}: {
  eligibleCount: number;
}) {
  const [armed, setArmed] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [failures, setFailures] = useState<
    Array<{ address: string; error: string }>
  >([]);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  if (eligibleCount <= 0 && !running && !done) return null;

  async function run() {
    setArmed(false);
    setRunning(true);
    setError(null);
    setProgress(0);
    setFailures([]);
    let totalSent = 0;
    const allFailures: Array<{ address: string; error: string }> = [];
    // Hard round cap: even if every chunk partially fails, we stop.
    for (let round = 0; round < 20; round++) {
      let r: BatchSendResult;
      try {
        r = await batchSendMissingInvoicesAction();
      } catch {
        setError("Network hiccup — tap again to continue where it left off.");
        break;
      }
      if (!r.ok) {
        setError(r.error);
        break;
      }
      totalSent += r.sent;
      allFailures.push(...r.failed);
      setProgress(totalSent);
      setFailures([...allFailures]);
      // Stop when everything's handled, or when a chunk sends nothing
      // (every remaining stage is failing — don't spin on them).
      if (r.remaining <= 0 || r.sent === 0) break;
    }
    setRunning(false);
    setDone(true);
    router.refresh();
  }

  if (running) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
        <Loader2 size={12} className="animate-spin" />
        Sending… {progress} invoice{progress === 1 ? "" : "s"} sent
      </span>
    );
  }

  if (done) {
    return (
      <span className="inline-flex flex-col items-end gap-0.5 text-right">
        <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-300">
          <Check size={12} /> {progress} invoice{progress === 1 ? "" : "s"}{" "}
          sent
        </span>
        {failures.length > 0 && (
          <span className="text-[11px] text-rose-700 max-w-[16rem] leading-tight">
            {failures.length} failed:{" "}
            {failures.map((f) => f.address).join(", ")}
          </span>
        )}
        {error && (
          <span className="text-[11px] text-rose-700 max-w-[16rem] leading-tight">
            {error}
          </span>
        )}
      </span>
    );
  }

  if (!armed) {
    return (
      <span className="inline-flex flex-col items-end gap-0.5">
        <button
          type="button"
          onClick={() => setArmed(true)}
          className="inline-flex items-center gap-1.5 text-xs border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 rounded-lg px-2.5 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
        >
          <Mail size={12} /> Send {eligibleCount} missing invoice
          {eligibleCount === 1 ? "" : "s"}
        </button>
        {error && (
          <span className="text-[11px] text-rose-700 max-w-[16rem] text-right leading-tight">
            {error}
          </span>
        )}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 dark:bg-slate-800/70 ring-1 ring-slate-200 dark:ring-slate-700 px-1 py-0.5">
      <span className="text-[11px] text-slate-600 dark:text-slate-300 pl-1.5">
        Email {eligibleCount} client invoice{eligibleCount === 1 ? "" : "s"}?
      </span>
      <button
        type="button"
        onClick={() => setArmed(false)}
        className="text-[11px] font-medium text-slate-700 dark:text-slate-300 px-2 py-0.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={run}
        className="inline-flex items-center gap-1 text-[11px] font-semibold text-white bg-slate-900 dark:bg-white dark:text-slate-900 px-2 py-0.5 rounded-full"
      >
        <Mail size={11} /> Send all
      </button>
    </span>
  );
}

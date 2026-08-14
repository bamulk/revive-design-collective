"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, Check, Loader2 } from "lucide-react";
import { changeStageTo90DaysAction } from "@/app/(app)/stages/actions";
import { formatMDY } from "@/lib/time";

/** stage_date + 90 in ISO, mirroring the server's addDaysISO. */
function plus90(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = Date.UTC(y, (m ?? 1) - 1, d ?? 1) + 90 * 86400000;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(
    2,
    "0",
  )}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Signature-card control that flips a stage to the 90-day term:
 * destage moves to stage_date + 90, the client is emailed a fresh
 * agreement showing the new term, and signing it triggers a fresh
 * invoice with the new dates (same price). Inline two-step confirm
 * spells all of that out before anything fires.
 */
export default function ChangeTo90Button({
  stageId,
  stageDate,
  stageLengthDays,
}: {
  stageId: string;
  stageDate: string | null;
  stageLengthDays: number | null;
}) {
  const [armed, setArmed] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (Number(stageLengthDays) === 90 && !done) {
    return (
      <p className="text-xs text-slate-500 dark:text-slate-400">
        90-day term active.
      </p>
    );
  }
  if (!stageDate) return null;

  const newDestage = plus90(stageDate);

  if (done) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-300">
        <Check size={12} /> Switched to 90 days — new agreement sent, destage
        now {formatMDY(done)}
      </span>
    );
  }

  function run() {
    setError(null);
    startTransition(async () => {
      const r = await changeStageTo90DaysAction(stageId);
      if (r.ok) {
        setDone(r.newDestage);
        setArmed(false);
        router.refresh();
      } else {
        setError(r.error);
        setArmed(false);
      }
    });
  }

  if (!armed) {
    return (
      <span className="inline-flex flex-col items-start gap-0.5">
        <button
          type="button"
          onClick={() => setArmed(true)}
          className="inline-flex items-center gap-1.5 text-xs border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 rounded-lg px-2.5 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
        >
          <CalendarPlus size={12} /> Change to 90-day term
        </button>
        {error && (
          <span className="text-[11px] text-rose-700 max-w-[20rem] leading-tight">
            {error}
          </span>
        )}
      </span>
    );
  }

  return (
    <div className="rounded-lg bg-slate-50 dark:bg-slate-800/70 ring-1 ring-slate-200 dark:ring-slate-700 p-2.5 space-y-1.5 text-xs text-slate-700 dark:text-slate-300">
      <p className="font-medium">Switch this stage to a 90-day term?</p>
      <p>
        Destage moves to <strong>{formatMDY(newDestage)}</strong>. The client
        gets a new agreement to sign, and once signed, a new invoice with the
        updated dates is emailed automatically. The price does not change.
      </p>
      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        <button
          type="button"
          onClick={run}
          disabled={pending}
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-white bg-slate-900 dark:bg-white dark:text-slate-900 px-2.5 py-1 rounded-full disabled:opacity-60"
        >
          {pending ? (
            <>
              <Loader2 size={11} className="animate-spin" /> Sending…
            </>
          ) : (
            "Yes — switch to 90 days"
          )}
        </button>
        <button
          type="button"
          onClick={() => setArmed(false)}
          disabled={pending}
          className="text-[11px] font-medium text-slate-700 dark:text-slate-300 px-2 py-1 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

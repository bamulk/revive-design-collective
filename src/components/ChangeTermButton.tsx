"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, Check, Loader2 } from "lucide-react";
import { changeStageTermAction } from "@/app/(app)/stages/actions";
import { formatMDY } from "@/lib/time";
import {
  MAX_STAGE_LENGTH,
  STAGE_LENGTHS,
  addStageDays,
} from "@/lib/stage-length";

/**
 * Signature-card control that changes a stage's rental period to any
 * number of days — the common terms as one-tap chips, or a typed value.
 * Destage moves to stage_date + days. If an agreement already went out,
 * the signer is sent a fresh one showing the new term, and signing it
 * triggers a fresh invoice with the new dates (same price). If nothing
 * has gone out yet, only the dates change. The confirm panel spells out
 * which of those will happen before anything fires.
 */
export default function ChangeTermButton({
  stageId,
  stageDate,
  stageLengthDays,
  hasEnvelope,
}: {
  stageId: string;
  stageDate: string | null;
  stageLengthDays: number | null;
  hasEnvelope: boolean;
}) {
  const current = Number(stageLengthDays) || 60;
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [done, setDone] = useState<{ days: number; destage: string; sent: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (!stageDate) {
    return (
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {current}-day term. Set a stage date to change it.
      </p>
    );
  }

  const days = Number(text);
  const valid =
    text !== "" && Number.isInteger(days) && days >= 1 && days <= MAX_STAGE_LENGTH;
  const same = valid && days === current;
  const newDestage = valid ? addStageDays(stageDate, days) : null;

  function run() {
    if (!valid || same) return;
    setError(null);
    startTransition(async () => {
      const r = await changeStageTermAction(stageId, days);
      if (r.ok) {
        setDone({ days: r.days, destage: r.newDestage, sent: r.agreementSent });
        setOpen(false);
        setText("");
        router.refresh();
      } else {
        setError(r.error);
      }
    });
  }

  if (!open) {
    return (
      <span className="inline-flex flex-col items-start gap-1">
        <span className="inline-flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setOpen(true);
              setDone(null);
              setError(null);
            }}
            className="inline-flex items-center gap-1.5 text-xs border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 rounded-lg px-2.5 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
          >
            <CalendarPlus size={12} /> Change stage length
          </button>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Currently {done ? done.days : current} days
          </span>
        </span>
        {done && (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-300">
            <Check size={12} /> Now {done.days} days — destage {formatMDY(done.destage)}
            {done.sent ? ", new agreement sent" : ""}
          </span>
        )}
      </span>
    );
  }

  const chip = (active: boolean) =>
    `px-2.5 py-1 rounded-full text-[11px] font-semibold border ${
      active
        ? "bg-slate-900 text-white border-slate-900 dark:bg-white dark:text-slate-900 dark:border-white"
        : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
    }`;

  return (
    <div className="rounded-lg bg-slate-50 dark:bg-slate-800/70 ring-1 ring-slate-200 dark:ring-slate-700 p-3 space-y-2 text-xs text-slate-700 dark:text-slate-300 max-w-md">
      <p className="font-medium">
        Change the stage length{" "}
        <span className="font-normal text-slate-500 dark:text-slate-400">
          (currently {current} days)
        </span>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {STAGE_LENGTHS.filter((d) => d !== current).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setText(String(d))}
            className={chip(text === String(d))}
          >
            {d} days
          </button>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={text}
            onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
            placeholder="Custom"
            aria-label="Stage length in days"
            className="w-20 border border-slate-300 dark:border-slate-600 rounded-lg px-2 py-1 text-sm bg-white dark:bg-slate-900 tabular-nums"
          />
          <span>days</span>
        </span>
      </div>

      {text !== "" && !valid && (
        <p className="text-rose-700 dark:text-rose-300">
          Enter a whole number of days between 1 and {MAX_STAGE_LENGTH}.
        </p>
      )}
      {same && <p className="text-slate-500">That&rsquo;s already the current term.</p>}
      {valid && !same && newDestage && (
        <p>
          Destage moves to <strong>{formatMDY(newDestage)}</strong>.{" "}
          {hasEnvelope
            ? "The signer gets a new agreement to sign, and once signed, a new invoice with the updated dates is emailed automatically."
            : "No agreement has gone out yet, so only the dates change — the agreement will use the new term when it's sent."}{" "}
          The price does not change.
        </p>
      )}
      {error && <p className="text-rose-700 dark:text-rose-300">{error}</p>}

      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        <button
          type="button"
          onClick={run}
          disabled={pending || !valid || same}
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-white bg-slate-900 dark:bg-white dark:text-slate-900 px-2.5 py-1 rounded-full disabled:opacity-50"
        >
          {pending ? (
            <>
              <Loader2 size={11} className="animate-spin" /> Saving…
            </>
          ) : valid && !same ? (
            `Yes — switch to ${days} days`
          ) : (
            "Switch"
          )}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          disabled={pending}
          className="text-[11px] font-medium text-slate-700 dark:text-slate-300 px-2 py-1 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

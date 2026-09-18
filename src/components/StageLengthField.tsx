"use client";

import { useState } from "react";
import {
  DEFAULT_STAGE_LENGTH,
  MAX_STAGE_LENGTH,
  STAGE_LENGTHS,
} from "@/lib/stage-length";

/**
 * Rental-period picker for the stage form: the two common terms as
 * one-tap chips, plus Custom for anything else (a 30-day pop-up, a
 * 120-day new build). Posts `stage_length_days`; the server validates
 * it and auto-fills the destage date to stage date + that many days.
 */
export default function StageLengthField({
  defaultDays = DEFAULT_STAGE_LENGTH,
}: {
  defaultDays?: number;
}) {
  const isPreset = (STAGE_LENGTHS as readonly number[]).includes(defaultDays);
  const [mode, setMode] = useState<"preset" | "custom">(isPreset ? "preset" : "custom");
  const [preset, setPreset] = useState<number>(isPreset ? defaultDays : DEFAULT_STAGE_LENGTH);
  // Kept as text so the field can be emptied and retyped freely.
  const [custom, setCustom] = useState<string>(isPreset ? "" : String(defaultDays));

  const value = mode === "preset" ? String(preset) : custom.trim();
  const days = Number(value);
  const valid = Number.isInteger(days) && days >= 1 && days <= MAX_STAGE_LENGTH;

  const chip = (active: boolean) =>
    `px-3 py-2 rounded-lg border text-sm font-medium transition ${
      active
        ? "bg-slate-900 text-white border-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:border-slate-100"
        : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800"
    }`;

  return (
    <div className="space-y-2">
      <input type="hidden" name="stage_length_days" value={value} />
      <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
        Stage length
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {STAGE_LENGTHS.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => {
              setMode("preset");
              setPreset(d);
            }}
            aria-pressed={mode === "preset" && preset === d}
            className={chip(mode === "preset" && preset === d)}
          >
            {d} days
          </button>
        ))}
        <button
          type="button"
          onClick={() => setMode("custom")}
          aria-pressed={mode === "custom"}
          className={chip(mode === "custom")}
        >
          Custom
        </button>
        {mode === "custom" && (
          <span className="inline-flex items-center gap-2">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoFocus
              required
              value={custom}
              onChange={(e) => setCustom(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
              placeholder="45"
              aria-label="Custom stage length in days"
              className="w-20 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 text-base bg-white dark:bg-slate-900 tabular-nums"
            />
            <span className="text-sm text-slate-600 dark:text-slate-400">days</span>
          </span>
        )}
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {mode === "custom" && custom !== "" && !valid
          ? `Enter a whole number of days between 1 and ${MAX_STAGE_LENGTH}.`
          : `Destage date auto-fills to the stage date + ${valid ? days : "…"} days. Printed on the agreement and invoice.`}
      </p>
    </div>
  );
}

"use client";

import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { STAGED_ROOMS, type StagedRoom } from "@/lib/staged-rooms";

const MAX_QTY = 20;

/**
 * Rooms / areas a stage covers, one row each with a − / + stepper.
 * Zero means "not included", so there's nothing to type and no separate
 * checkbox: tap + to add a room, keep tapping for a big house. Tapping
 * the room's name toggles it between off and its usual count (3 for
 * bedrooms, 1 for most). Emits one hidden field the server reads:
 *   - staged_rooms: JSON-encoded [{ key, qty }]
 */
export default function StagedRoomsFields({
  defaultRooms = [],
}: {
  defaultRooms?: StagedRoom[];
}) {
  const [qty, setQty] = useState<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    for (const r of defaultRooms) map[r.key] = r.qty;
    return map;
  });

  function set(key: string, n: number) {
    setQty((prev) => {
      const next = { ...prev };
      const v = Math.min(MAX_QTY, Math.max(0, n));
      if (v === 0) delete next[key];
      else next[key] = v;
      return next;
    });
  }

  // Catalog order so the posted value matches how documents print.
  const value: StagedRoom[] = STAGED_ROOMS.filter((r) => (qty[r.key] ?? 0) > 0).map(
    (r) => ({ key: r.key as string, qty: qty[r.key] }),
  );
  const totalRooms = value.reduce((s, r) => s + r.qty, 0);

  const stepBtn =
    "w-9 h-9 inline-flex items-center justify-center rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-white dark:disabled:hover:bg-slate-900 touch-manipulation select-none";

  return (
    <div className="space-y-2">
      <input type="hidden" name="staged_rooms" value={JSON.stringify(value)} />
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
          Rooms included
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
          {totalRooms === 0 ? "None selected" : `${totalRooms} total`}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
        {STAGED_ROOMS.map((r) => {
          const n = qty[r.key] ?? 0;
          const on = n > 0;
          return (
            <div
              key={r.key}
              className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1 ${
                on ? "bg-slate-50 dark:bg-slate-800/60" : ""
              }`}
            >
              <button
                type="button"
                onClick={() => set(r.key, on ? 0 : r.defaultQty)}
                aria-pressed={on}
                className={`flex-1 min-w-0 text-left text-sm py-1.5 ${
                  on
                    ? "font-medium text-slate-900 dark:text-slate-100"
                    : "text-slate-600 dark:text-slate-400"
                }`}
              >
                {r.label}
              </button>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => set(r.key, n - 1)}
                  disabled={n === 0}
                  aria-label={`One fewer: ${r.label}`}
                  className={stepBtn}
                >
                  <Minus size={14} />
                </button>
                <span
                  aria-live="polite"
                  className={`w-6 text-center text-sm tabular-nums ${
                    on
                      ? "font-semibold text-slate-900 dark:text-slate-100"
                      : "text-slate-400 dark:text-slate-500"
                  }`}
                >
                  {n}
                </span>
                <button
                  type="button"
                  onClick={() => set(r.key, n + 1)}
                  disabled={n >= MAX_QTY}
                  aria-label={`One more: ${r.label}`}
                  className={stepBtn}
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Tap + to add a room; tap a name to switch it on or off. Printed on the
        agreement, the invoice, and the agent&rsquo;s email.
      </p>
    </div>
  );
}

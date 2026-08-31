"use client";

import { useState } from "react";
import { STAGED_ROOMS, type StagedRoom } from "@/lib/staged-rooms";

/**
 * Checkbox list of the rooms / areas a stage covers. Countable rooms
 * (bedrooms, outdoor areas) get a quantity box once checked. Emits one
 * hidden field the server action reads:
 *   - staged_rooms: JSON-encoded [{ key, qty }]
 */
export default function StagedRoomsFields({
  defaultRooms = [],
}: {
  defaultRooms?: StagedRoom[];
}) {
  const [picked, setPicked] = useState<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    for (const r of defaultRooms) map[r.key] = r.qty;
    return map;
  });

  function toggle(key: string, defaultQty: number) {
    setPicked((prev) => {
      const next = { ...prev };
      if (key in next) delete next[key];
      else next[key] = defaultQty;
      return next;
    });
  }

  function setQty(key: string, qty: number) {
    setPicked((prev) => ({
      ...prev,
      [key]: Math.min(20, Math.max(1, Math.round(qty) || 1)),
    }));
  }

  // Catalog order so the posted value matches how documents print.
  const value: StagedRoom[] = STAGED_ROOMS.filter((r) => r.key in picked).map(
    (r) => ({ key: r.key as string, qty: picked[r.key] }),
  );

  return (
    <div className="space-y-2">
      <input
        type="hidden"
        name="staged_rooms"
        value={JSON.stringify(value)}
      />
      <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
        Rooms included
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
        {STAGED_ROOMS.map((r) => {
          const on = r.key in picked;
          return (
            <div key={r.key} className="flex items-center gap-2 text-sm">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggle(r.key, r.defaultQty)}
                  className="h-4 w-4 accent-brand"
                />
                <span
                  className={
                    on
                      ? "text-slate-900 dark:text-slate-100"
                      : "text-slate-600 dark:text-slate-400"
                  }
                >
                  {r.label}
                </span>
              </label>
              {on && r.countable && (
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={picked[r.key]}
                  onChange={(e) => setQty(r.key, Number(e.target.value))}
                  aria-label={`How many ${r.label.toLowerCase()}`}
                  className="w-16 border rounded px-2 py-1 text-sm"
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

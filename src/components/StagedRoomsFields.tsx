"use client";

import { useState } from "react";
import { STAGED_ROOMS } from "@/lib/staged-rooms";

/**
 * Checkbox list of the rooms / areas a stage covers. Emits one hidden
 * field the server action reads:
 *   - staged_rooms: JSON-encoded array of room keys
 */
export default function StagedRoomsFields({
  defaultRooms = [],
}: {
  defaultRooms?: string[];
}) {
  const [picked, setPicked] = useState<string[]>(defaultRooms);

  function toggle(key: string) {
    setPicked((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }

  return (
    <div className="space-y-2">
      <input type="hidden" name="staged_rooms" value={JSON.stringify(picked)} />
      <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
        Rooms included
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
        {STAGED_ROOMS.map((r) => {
          const on = picked.includes(r.key);
          return (
            <label
              key={r.key}
              className="flex items-center gap-2 text-sm cursor-pointer"
            >
              <input
                type="checkbox"
                checked={on}
                onChange={() => toggle(r.key)}
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
          );
        })}
      </div>
    </div>
  );
}

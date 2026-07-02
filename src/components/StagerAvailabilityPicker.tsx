"use client";

import { useRouter } from "next/navigation";

export type PickerStager = { id: string; name: string };

/**
 * Admin-only picker: choose which stager's availability to edit. Changing
 * the selection navigates to /availability?stager=<id> so the server
 * re-loads that stager's schedule.
 */
export default function StagerAvailabilityPicker({
  stagers,
  selectedId,
}: {
  stagers: PickerStager[];
  selectedId: string | null;
}) {
  const router = useRouter();
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-slate-600 dark:text-slate-400">Stager</span>
      <select
        value={selectedId ?? ""}
        onChange={(e) => {
          const id = e.target.value;
          router.push(id ? `/availability?stager=${id}` : "/availability");
        }}
        className="border rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-900"
      >
        <option value="">Select a stager…</option>
        {stagers.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </label>
  );
}

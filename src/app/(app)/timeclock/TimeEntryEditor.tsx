"use client";

import { useState } from "react";
import { addEntryAction, updateEntryAction } from "./actions";

/** ISO/UTC -> a value for <input type="datetime-local"> in the user's local tz. */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

/**
 * Add a new completed entry, or edit an existing one's clock-in/out.
 * The datetime-local inputs are in the user's local timezone (Pacific);
 * the browser converts them to ISO/UTC before sending, so DST is handled.
 *
 * Edit (entryId set) works on the user's own entries, or any entry for an
 * admin — RLS on time_entries enforces that.
 */
export default function TimeEntryEditor({
  entryId,
  initialIn,
  initialOut,
  triggerLabel,
  triggerClassName,
}: {
  entryId?: string;
  initialIn?: string | null;
  initialOut?: string | null;
  triggerLabel: string;
  triggerClassName?: string;
}) {
  const isEdit = !!entryId;
  const [open, setOpen] = useState(false);
  const [inVal, setInVal] = useState(() => toLocalInput(initialIn));
  const [outVal, setOutVal] = useState(() => toLocalInput(initialOut));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const input =
    "border border-slate-300 dark:border-slate-600 rounded px-3 py-2 text-base bg-white dark:bg-slate-900";

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          triggerClassName ??
          "text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
        }
      >
        {triggerLabel}
      </button>
    );
  }

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        if (!inVal || !outVal) {
          setError("Both clock-in and clock-out are required.");
          return;
        }
        const ci = new Date(inVal);
        const co = new Date(outVal);
        if (co.getTime() <= ci.getTime()) {
          setError("Clock-out must be after clock-in.");
          return;
        }
        setSaving(true);
        try {
          if (isEdit) {
            await updateEntryAction(entryId!, ci.toISOString(), co.toISOString());
          } else {
            await addEntryAction(ci.toISOString(), co.toISOString());
          }
          setOpen(false);
          if (!isEdit) {
            setInVal("");
            setOutVal("");
          }
        } catch (err: any) {
          setError(err?.message || "Couldn't save the entry.");
        } finally {
          setSaving(false);
        }
      }}
      className="bg-slate-50 dark:bg-slate-800/40 rounded-lg p-3 space-y-2 mt-1"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="text-sm">
          <span className="block text-xs text-slate-600 dark:text-slate-400 mb-1">
            Clock in
          </span>
          <input
            type="datetime-local"
            value={inVal}
            onChange={(e) => setInVal(e.target.value)}
            required
            className={`${input} w-full`}
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-slate-600 dark:text-slate-400 mb-1">
            Clock out
          </span>
          <input
            type="datetime-local"
            value={outVal}
            onChange={(e) => setOutVal(e.target.value)}
            required
            className={`${input} w-full`}
          />
        </label>
      </div>
      {error && <p className="text-xs text-rose-600">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          disabled={saving}
          className="bg-slate-900 text-white rounded-lg px-4 py-2 text-sm disabled:opacity-70"
        >
          {saving ? "Saving…" : isEdit ? "Save" : "Add entry"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="text-sm text-slate-600 dark:text-slate-400 hover:underline"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

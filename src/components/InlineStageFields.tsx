"use client";

import { useState, useTransition } from "react";
import { Loader2, Check } from "lucide-react";
import { updateStageFieldAction } from "@/app/(app)/stages/actions";

type FieldKey =
  | "stage_date"
  | "destage_date"
  | "lockbox_code"
  | "notes"
  | "bill_to";

/**
 * Admin-only inline-editable stage fields with autosave. Renders the
 * stage date, destage date, lockbox code, and notes as editable
 * inputs that save on blur (when the value actually changed). No
 * "Edit" mode, no submit button.
 *
 * stage_date / destage_date / lockbox sit in a grid; notes is a
 * full-width textarea below. Miles-from-warehouse is passed through as a
 * read-only cell so the grid layout matches the old read-only view.
 */
export default function InlineStageFields({
  stageId,
  stageDate,
  destageDate,
  lockboxCode,
  billTo,
  notes,
  milesFromWarehouse,
}: {
  stageId: string;
  stageDate: string | null;
  destageDate: string | null;
  lockboxCode: string | null;
  /** Billing entity (e.g. an LLC) printed as the invoice's Bill To. */
  billTo: string | null;
  notes: string | null;
  milesFromWarehouse: number | null;
}) {
  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 text-sm">
        <InlineField
          stageId={stageId}
          field="stage_date"
          label="Stage date"
          type="date"
          initial={stageDate ?? ""}
        />
        <InlineField
          stageId={stageId}
          field="destage_date"
          label="Destage date"
          type="date"
          initial={destageDate ?? ""}
        />
        <InlineField
          stageId={stageId}
          field="lockbox_code"
          label="Lockbox code"
          type="text"
          initial={lockboxCode ?? ""}
          mono
          placeholder="e.g. 1234"
        />
        <InlineField
          stageId={stageId}
          field="bill_to"
          label="Bill to (invoice)"
          type="text"
          initial={billTo ?? ""}
          placeholder="LLC or company — blank = client"
        />
        <div>
          <FieldLabel>Miles from warehouse</FieldLabel>
          <div className="mt-1">
            {milesFromWarehouse != null ? (
              <span title="Straight-line distance from 6135 Rio Linda Blvd">
                {milesFromWarehouse.toFixed(1)} mi
                <span className="block text-[10px] text-slate-500 dark:text-slate-400">
                  straight line
                </span>
              </span>
            ) : (
              <span className="text-slate-400 dark:text-slate-500">—</span>
            )}
          </div>
        </div>
      </div>

      <div className="pt-1">
        <InlineNotes stageId={stageId} initial={notes ?? ""} />
      </div>
    </>
  );
}

/**
 * Standalone inline-editable lockbox code for the stager (non-admin)
 * view. Same autosave behavior as the admin grid, but only the lockbox
 * field — stagers need to update the code from the field while the
 * rest of the stage details stay read-only.
 */
export function InlineLockboxField({
  stageId,
  lockboxCode,
}: {
  stageId: string;
  lockboxCode: string | null;
}) {
  return (
    <InlineField
      stageId={stageId}
      field="lockbox_code"
      label="Lockbox code"
      type="text"
      initial={lockboxCode ?? ""}
      mono
      placeholder="e.g. 1234"
    />
  );
}

/**
 * Standalone inline-editable notes box for the stager (non-admin)
 * view. Stagers and lead stagers add access notes / special
 * instructions from the field; saves on blur like the admin version.
 */
export function InlineNotesField({
  stageId,
  notes,
}: {
  stageId: string;
  notes: string | null;
}) {
  return <InlineNotes stageId={stageId} initial={notes ?? ""} />;
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
      {children}
    </div>
  );
}

/** Tiny saved/saving/error indicator shared by the fields. */
function SaveState({
  pending,
  savedAt,
  err,
}: {
  pending: boolean;
  savedAt: number | null;
  err: string | null;
}) {
  if (err)
    return <span className="text-[10px] text-rose-600 dark:text-rose-400">{err}</span>;
  if (pending)
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-slate-400 dark:text-slate-500">
        <Loader2 size={9} className="animate-spin" /> Saving
      </span>
    );
  if (savedAt)
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
        <Check size={9} /> Saved
      </span>
    );
  return null;
}

function InlineField({
  stageId,
  field,
  label,
  type,
  initial,
  mono = false,
  placeholder,
}: {
  stageId: string;
  field: FieldKey;
  label: string;
  type: "date" | "text";
  initial: string;
  mono?: boolean;
  placeholder?: string;
}) {
  const [value, setValue] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function save() {
    if (value === initial) return; // no-op if unchanged
    setErr(null);
    startTransition(async () => {
      const res = await updateStageFieldAction(stageId, field, value);
      if (!res.ok) setErr(res.error);
      else setSavedAt(Date.now());
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-1">
        <FieldLabel>{label}</FieldLabel>
        <SaveState pending={pending} savedAt={savedAt} err={err} />
      </div>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        className={`mt-1 w-full border border-slate-200 dark:border-slate-700 rounded px-2 py-1.5 text-sm bg-white dark:bg-slate-900 ${
          mono ? "font-mono tracking-wider" : ""
        }`}
      />
    </div>
  );
}

function InlineNotes({
  stageId,
  initial,
}: {
  stageId: string;
  initial: string;
}) {
  const [value, setValue] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function save() {
    if (value === initial) return;
    setErr(null);
    startTransition(async () => {
      const res = await updateStageFieldAction(stageId, "notes", value);
      if (!res.ok) setErr(res.error);
      else setSavedAt(Date.now());
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-1">
        <FieldLabel>Notes</FieldLabel>
        <SaveState pending={pending} savedAt={savedAt} err={err} />
      </div>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        rows={3}
        placeholder="Access notes, special instructions…"
        className="mt-1 w-full border border-slate-200 dark:border-slate-700 rounded px-2 py-1.5 text-sm bg-white dark:bg-slate-900"
      />
    </div>
  );
}

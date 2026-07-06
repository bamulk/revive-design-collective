"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { updateStageClientAction } from "@/app/(app)/stages/actions";

/**
 * Admin-only "Change" affordance next to the client name on the stage
 * detail page. Opens an inline picker of existing clients and reassigns
 * the stage via updateStageClientAction. Reassignment affects billing,
 * contracts, and portal visibility going forward — documents already
 * generated keep the old client until regenerated, so the confirm copy
 * says exactly that.
 */
export default function StageClientControl({
  stageId,
  currentClientId,
  clients,
}: {
  stageId: string;
  currentClientId: string | null;
  clients: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(currentClientId ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save() {
    if (!selected || selected === currentClientId) {
      setOpen(false);
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await updateStageClientAction(stageId, selected);
      if (r.ok) {
        setOpen(false);
      } else {
        setError(r.error);
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setSelected(currentClientId ?? "");
          setError(null);
          setOpen(true);
        }}
        className="text-xs text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 underline decoration-dotted underline-offset-2"
      >
        Change
      </button>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2 align-middle">
      <select
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        disabled={pending}
        className="border border-slate-300 dark:border-slate-600 rounded-lg px-2 py-1.5 text-sm bg-white dark:bg-slate-900 max-w-[16rem]"
      >
        <option value="" disabled>
          Pick a client…
        </option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={save}
        disabled={pending || !selected || selected === currentClientId}
        className="inline-flex items-center gap-1.5 bg-slate-900 text-white dark:bg-white dark:text-slate-900 rounded-lg px-2.5 py-1.5 text-xs disabled:opacity-60"
      >
        {pending ? (
          <>
            <Loader2 size={12} className="animate-spin" /> Saving…
          </>
        ) : (
          "Save"
        )}
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setError(null);
        }}
        disabled={pending}
        className="text-xs text-slate-600 dark:text-slate-400 hover:underline disabled:opacity-60"
      >
        Cancel
      </button>
      {/* Future invoices/contracts pick up the new client; already-
          generated documents keep the old one until regenerated. */}
      <span className="block w-full text-[11px] text-slate-500 dark:text-slate-400">
        New invoices and contracts use the new client; documents already
        generated keep the old one until regenerated.
      </span>
      {error && (
        <span className="block w-full text-xs text-rose-700">{error}</span>
      )}
    </span>
  );
}

"use client";

import { useState } from "react";
import { Check, Users } from "lucide-react";
import { formatMDY } from "@/lib/time";
import { assignTeamAction, type TeamKey } from "@/app/(app)/plan/actions";

export type CrewStager = { id: string; name: string };

type Crew = {
  team: TeamKey | null;
  stagerIds: string[];
  date: string | null;
};

/**
 * Crew panel on the stage detail page. Any team member (stagers, lead
 * stagers, admins) can assign the staging and destaging crews — same write
 * path as the Plan page (assignTeamAction).
 */
export default function CrewSection({
  stageId,
  staging,
  destaging,
  roster,
}: {
  stageId: string;
  staging: Crew;
  destaging: Crew;
  /** Full stager roster for the multi-select. */
  roster: CrewStager[];
}) {
  return (
    <section className="bg-white dark:bg-slate-900 border rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Crew</h2>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          Tap a stager to assign
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <CrewEditor
          title="Staged by"
          stageId={stageId}
          kind="stage"
          crew={staging}
          roster={roster}
        />
        <CrewEditor
          title="Destaged by"
          stageId={stageId}
          kind="destage"
          crew={destaging}
          roster={roster}
        />
      </div>
    </section>
  );
}

function CrewEditor({
  title,
  stageId,
  kind,
  crew,
  roster,
}: {
  title: string;
  stageId: string;
  kind: "stage" | "destage";
  crew: Crew;
  roster: CrewStager[];
}) {
  const [stagerIds, setStagerIds] = useState<string[]>(crew.stagerIds);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Plain async (not useTransition): the server action calls
  // revalidatePath on the heavy stage page, and a transition stays
  // "saving" until that whole refresh settles — which left the buttons
  // stuck disabled. With a local flag we re-enable as soon as the write
  // returns; the page data refreshes in the background.
  async function save(nextStagers: string[]) {
    setErr(null);
    setSaving(true);
    try {
      const res = await assignTeamAction({
        stageId,
        kind,
        team: null,
        stagerIds: nextStagers,
      });
      if (!res.ok) setErr(res.error);
      else setSavedAt(Date.now());
    } catch (e: any) {
      setErr(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function toggleStager(id: string) {
    const next = stagerIds.includes(id)
      ? stagerIds.filter((x) => x !== id)
      : [...stagerIds, id];
    setStagerIds(next);
    save(next);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs uppercase tracking-wide text-slate-600 dark:text-slate-400">
          {title}
        </h3>
        {crew.date && (
          <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
            {formatMDY(crew.date)}
          </span>
        )}
      </div>

      {/* Stager multi-select */}
      <div className="space-y-1">
        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
          <Users size={11} />
          Stagers
        </div>
        {roster.length === 0 ? (
          <p className="text-xs italic text-slate-500 dark:text-slate-400">
            No stagers in the roster.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {roster.map((s) => {
              const on = stagerIds.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggleStager(s.id)}
                  disabled={saving}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs transition ${
                    on
                      ? "bg-emerald-600 text-white"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                  } disabled:opacity-60`}
                >
                  {on && <Check size={11} />}
                  {s.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="text-[11px] text-slate-500 dark:text-slate-400 h-4">
        {err ? (
          <span className="text-rose-600 dark:text-rose-400">{err}</span>
        ) : saving ? (
          "Saving…"
        ) : savedAt ? (
          "Saved"
        ) : null}
      </div>
    </div>
  );
}

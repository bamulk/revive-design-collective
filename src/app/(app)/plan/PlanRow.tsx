"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Check, Users } from "lucide-react";
import { assignTeamAction, type TeamKey } from "./actions";

export type Stager = { id: string; name: string };

export type PlanJob = {
  id: string;
  address: string;
  city: string | null;
  clientName: string | null;
  kind: "stage" | "destage";
  team: TeamKey | null;
  stagerIds: string[];
};

const TEAMS: { key: TeamKey; label: string; chip: string; chipActive: string }[] = [
  {
    key: "grey",
    label: "Grey",
    chip: "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700",
    chipActive: "bg-slate-700 text-white dark:bg-slate-200 dark:text-slate-900",
  },
  {
    key: "white",
    label: "White",
    chip: "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-800",
    chipActive: "bg-slate-900 text-white ring-slate-900 dark:bg-white dark:text-slate-900 dark:ring-white",
  },
  {
    key: "little",
    label: "Little",
    chip: "bg-amber-50 text-amber-800 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-900/40",
    chipActive: "bg-amber-600 text-white dark:bg-amber-500",
  },
];

export default function PlanRow({
  job,
  stagers,
  availableStagerIds = [],
  isAdmin = false,
}: {
  job: PlanJob;
  stagers: Stager[];
  /** Ids of stagers who marked themselves available on this job's day. */
  availableStagerIds?: string[];
  /** Stagers see the plan read-only — only admins can re-assign. */
  isAdmin?: boolean;
}) {
  const availableSet = new Set(availableStagerIds);
  // Show available stagers first in the picker so the admin sees who's
  // free without hunting; ties keep the incoming (alphabetical) order.
  const orderedStagers = [...stagers].sort((a, b) => {
    const av = availableSet.has(a.id) ? 0 : 1;
    const bv = availableSet.has(b.id) ? 0 : 1;
    return av - bv;
  });
  const availableCount = stagers.filter((s) => availableSet.has(s.id)).length;
  const [team, setTeam] = useState<TeamKey | null>(job.team);
  const [stagerIds, setStagerIds] = useState<string[]>(job.stagerIds);
  const [pending, startTransition] = useTransition();
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function save(nextTeam: TeamKey | null, nextStagers: string[]) {
    setErr(null);
    startTransition(async () => {
      const res = await assignTeamAction({
        stageId: job.id,
        kind: job.kind,
        team: nextTeam,
        stagerIds: nextStagers,
      });
      if (!res.ok) setErr(res.error);
      else setSavedAt(Date.now());
    });
  }

  function pickTeam(t: TeamKey) {
    const next = team === t ? null : t;
    setTeam(next);
    if (next === null) setStagerIds([]);
    save(next, next === null ? [] : stagerIds);
  }

  function toggleStager(id: string) {
    const next = stagerIds.includes(id)
      ? stagerIds.filter((x) => x !== id)
      : [...stagerIds, id];
    setStagerIds(next);
    save(team, next);
  }

  // Color-tint the card border by kind to match the dashboard Today
  // cards (blue=stage, orange=destage).
  const tint =
    job.kind === "stage"
      ? "border-blue-200 dark:border-blue-900/60"
      : "border-orange-200 dark:border-orange-900/60";
  const kindBadge =
    job.kind === "stage"
      ? "bg-blue-600 text-white"
      : "bg-orange-600 text-white";

  return (
    <div
      className={`bg-white dark:bg-slate-900 border ${tint} rounded-xl p-3 shadow-sm space-y-3`}
    >
      {/* Header row: address + kind tag */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <Link
            href={`/stages/${job.id}`}
            className="font-medium text-slate-900 dark:text-slate-100 hover:text-brand truncate block"
          >
            {job.address}
          </Link>
          <div className="text-xs text-slate-600 dark:text-slate-400 truncate">
            {[job.city, job.clientName].filter(Boolean).join(" · ") || "—"}
          </div>
        </div>
        <span
          className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${kindBadge}`}
        >
          {job.kind === "stage" ? "Stage" : "Destage"}
        </span>
      </div>

      {/* Team picker (admin) or read-only team chip (stager) */}
      {isAdmin ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 mr-1">
            Team
          </span>
          {TEAMS.map((t) => {
            const active = team === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => pickTeam(t.key)}
                disabled={pending}
                className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium transition ${
                  active ? t.chipActive : t.chip
                } disabled:opacity-60`}
              >
                {active && <Check size={12} />}
                {t.label}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 mr-1">
            Team
          </span>
          {team ? (
            <span
              className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium ${
                TEAMS.find((t) => t.key === team)?.chipActive ?? ""
              }`}
            >
              {TEAMS.find((t) => t.key === team)?.label}
            </span>
          ) : (
            <span className="text-xs italic text-slate-500 dark:text-slate-400">
              Not assigned yet
            </span>
          )}
        </div>
      )}

      {/* Stager list — interactive multi-select for admins, read-only
          chips for stagers. */}
      {team !== null && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
            <Users size={12} />
            Stagers on this job
            {isAdmin && (
              <span className="normal-case tracking-normal text-emerald-700 dark:text-emerald-400">
                · {availableCount} available
              </span>
            )}
          </div>
          {isAdmin ? (
            stagers.length === 0 ? (
              <p className="text-xs italic text-slate-500 dark:text-slate-400">
                No stagers in the roster yet — add them on the{" "}
                <Link href="/employees" className="underline">
                  Team page
                </Link>
                .
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {orderedStagers.map((s) => {
                  const on = stagerIds.includes(s.id);
                  const free = availableSet.has(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => toggleStager(s.id)}
                      disabled={pending}
                      title={free ? "Available this day" : "Not marked available"}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs transition disabled:opacity-60 ${
                        on
                          ? "bg-emerald-600 text-white"
                          : free
                            ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-300 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-200 dark:ring-emerald-700"
                            : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                      }`}
                    >
                      {on ? (
                        <Check size={11} />
                      ) : free ? (
                        <span
                          className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500"
                          aria-hidden="true"
                        />
                      ) : null}
                      {s.name}
                    </button>
                  );
                })}
              </div>
            )
          ) : stagerIds.length === 0 ? (
            <p className="text-xs italic text-slate-500 dark:text-slate-400">
              No stagers picked yet
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {stagerIds.map((id) => {
                const name =
                  stagers.find((s) => s.id === id)?.name ?? "Unknown";
                return (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-emerald-600 text-white"
                  >
                    {name}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Status line — only for admins (only they can save). */}
      {isAdmin && (
        <div className="text-[11px] text-slate-500 dark:text-slate-400 h-4">
          {err ? (
            <span className="text-rose-600 dark:text-rose-400">{err}</span>
          ) : pending ? (
            "Saving…"
          ) : savedAt ? (
            "Saved"
          ) : null}
        </div>
      )}
    </div>
  );
}

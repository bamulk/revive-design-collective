// Small color-coded badge for the team a stage/destage is assigned to.
// Used on the dashboard Today cards and on the stage cards in /stages/groups.
//
// Three teams, three palettes:
//   Grey   → neutral slate
//   White  → bright white-on-dark-outline (legible on tinted cards)
//   Little → amber (warm, distinct from the blue/orange kind tags)

import { Users } from "lucide-react";

export type TeamKey = "grey" | "white" | "little";

const STYLES: Record<TeamKey, { label: string; cls: string }> = {
  grey: {
    label: "Grey",
    cls: "bg-slate-700 text-white ring-slate-800 dark:bg-slate-200 dark:text-slate-900 dark:ring-slate-100",
  },
  white: {
    label: "White",
    cls: "bg-white text-slate-900 ring-slate-300 dark:bg-white dark:text-slate-900 dark:ring-slate-200",
  },
  little: {
    label: "Little",
    cls: "bg-amber-500 text-white ring-amber-600 dark:bg-amber-500 dark:text-slate-900 dark:ring-amber-400",
  },
};

export default function TeamTag({
  team,
  className = "",
}: {
  team: TeamKey | null | undefined;
  className?: string;
}) {
  if (!team || !(team in STYLES)) return null;
  const s = STYLES[team as TeamKey];
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold ring-1 ring-inset ${s.cls} ${className}`}
      title={`${s.label} team`}
    >
      <Users size={10} />
      {s.label}
    </span>
  );
}

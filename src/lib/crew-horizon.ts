import { addDaysISO, todayPacificISO } from "@/lib/time";

/**
 * How far ahead the crew (stagers + lead stagers) can see. Admins see
 * everything; everyone else sees upcoming stages and scheduled destages
 * only within this many days of today. Applied server-side wherever a
 * stage list, calendar, search, or detail page is built for a
 * non-admin, so the hidden dates never reach the browser.
 */
export const CREW_HORIZON_DAYS = 3;

/** Last visible date (inclusive) for the crew, as ISO yyyy-mm-dd. */
export function crewHorizonISO(today: string = todayPacificISO()): string {
  return addDaysISO(today, CREW_HORIZON_DAYS);
}

type StageDates = {
  status: string;
  stage_date: string | null;
  destage_date: string | null;
};

/**
 * Apply the horizon to one stage for a non-admin viewer.
 *   - An upcoming (scheduled) stage beyond the horizon — or with no
 *     date yet — is not visible at all: returns null.
 *   - Any other stage stays visible, but a destage date beyond the
 *     horizon is blanked so the crew can't see it yet.
 */
export function applyCrewHorizon<T extends StageDates>(
  stage: T,
  horizon: string,
): T | null {
  if (stage.status === "scheduled") {
    if (!stage.stage_date || stage.stage_date > horizon) return null;
    return stage;
  }
  if (stage.destage_date && stage.destage_date > horizon) {
    return { ...stage, destage_date: null };
  }
  return stage;
}

export function applyCrewHorizonAll<T extends StageDates>(
  rows: T[],
  horizon: string,
): T[] {
  const out: T[] = [];
  for (const r of rows) {
    const v = applyCrewHorizon(r, horizon);
    if (v) out.push(v);
  }
  return out;
}

/**
 * Stage rental length helpers. Lives outside the "use server" actions
 * file because that file is only allowed to export async functions.
 *
 * The length is any whole number of days — 60 is the standard term and
 * 90 the common extended one, but a stage can run whatever was agreed
 * (a 30-day pop-up, a 120-day new build). Must mirror the
 * stages.stage_length_days DB check (1..365).
 */

/** Quick-pick presets offered in the UI. */
export const STAGE_LENGTHS = [60, 90] as const;
export const DEFAULT_STAGE_LENGTH = 60;
export const MIN_STAGE_LENGTH = 1;
export const MAX_STAGE_LENGTH = 365;

export type StageLength = number;

/** Coerce arbitrary input into a valid length in days (default 60). */
export function normalizeStageLength(v: unknown): StageLength {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < MIN_STAGE_LENGTH) return DEFAULT_STAGE_LENGTH;
  return Math.min(n, MAX_STAGE_LENGTH);
}

/** True only for an in-range whole number — used to reject bad input
 *  outright instead of silently falling back to 60. */
export function isValidStageLength(v: unknown): boolean {
  const n = Number(v);
  return Number.isInteger(n) && n >= MIN_STAGE_LENGTH && n <= MAX_STAGE_LENGTH;
}

/** stage_date + days, in ISO. UTC math so the day never drifts. */
export function addStageDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1) + days * 86400000);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(
    dt.getUTCDate(),
  ).padStart(2, "0")}`;
}

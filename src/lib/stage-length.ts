/**
 * Stage rental length helpers. Lives outside the "use server" actions
 * file because that file is only allowed to export async functions, so
 * `STAGE_LENGTHS`, the `StageLength` type, and the sync normalizer
 * couldn't live there at module scope.
 */

/** Allowed stage lengths (must mirror the stages.stage_length_days DB check). */
export const STAGE_LENGTHS = [60, 90] as const;
export type StageLength = (typeof STAGE_LENGTHS)[number];

/** Coerce arbitrary form input into a valid StageLength (default 60). */
export function normalizeStageLength(v: unknown): StageLength {
  const n = Number(v);
  return STAGE_LENGTHS.includes(n as StageLength) ? (n as StageLength) : 60;
}

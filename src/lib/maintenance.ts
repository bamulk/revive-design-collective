/**
 * Fleet maintenance helpers.
 *
 * Trailers don't have engines/odometers, so no oil changes or mileage —
 * they just get serviced on a fixed cycle (every 6 months).
 */

export const TRAILER_SERVICE_INTERVAL_MONTHS = 6;

/** Add whole months to a YYYY-MM-DD date, returning YYYY-MM-DD. */
export function addMonthsISO(iso: string, months: number): string {
  // Anchor at noon UTC so DST / timezone shifts can't bump the date.
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/**
 * Trailer service-due status from the last service date. Never serviced
 * (null) counts as due. Compares YYYY-MM-DD strings (lexical == chronological).
 */
export function trailerServiceDue(
  lastServiceISO: string | null,
  todayISO: string,
): { due: boolean; nextDueISO: string | null } {
  if (!lastServiceISO) return { due: true, nextDueISO: null };
  const nextDueISO = addMonthsISO(
    lastServiceISO,
    TRAILER_SERVICE_INTERVAL_MONTHS,
  );
  return { due: nextDueISO <= todayISO, nextDueISO };
}

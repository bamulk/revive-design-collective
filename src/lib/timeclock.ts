/**
 * Time-clock helpers. Hours are tracked in the company's timezone
 * (Pacific) so "today" / "this week" line up with the crew's actual day.
 * Pure functions — safe to import from client or server.
 */
const PT = "America/Los_Angeles";

/** YYYY-MM-DD for a timestamp, in Pacific. */
export function pacificDate(ts: string | Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: PT }).format(
    new Date(ts),
  );
}

/** e.g. "8:05 AM" for a timestamp, in Pacific. */
export function pacificTime(ts: string | Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: PT,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ts));
}

/** e.g. "Wed, Jun 25" for a YYYY-MM-DD date string. */
export function pacificDayLabel(dateISO: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: PT,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(`${dateISO}T12:00:00Z`));
}

/** Duration in ms -> "Xh Ym" (or "Ym"). */
export function fmtDuration(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h === 0 ? `${m}m` : `${h}h ${m}m`;
}

/** Duration in ms -> decimal hours string (payroll), e.g. "8.25". */
export function fmtHours(ms: number): string {
  return (Math.max(0, ms) / 3_600_000).toFixed(2);
}

/** Completed entry duration, or running time for an open entry, in ms. */
export function entryMs(
  clockIn: string,
  clockOut: string | null,
  nowMs: number,
): number {
  const start = Date.parse(clockIn);
  const end = clockOut ? Date.parse(clockOut) : nowMs;
  return Math.max(0, end - start);
}

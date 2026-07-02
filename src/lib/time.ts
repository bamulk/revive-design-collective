/**
 * All date math in this app is anchored to Pacific time.
 * Vercel servers run in UTC, so `new Date().getFullYear()` would
 * give you UTC's date — meaning "today" rolls over at 4-5 PM PST.
 * These helpers always work in America/Los_Angeles regardless of
 * where the code is running.
 */

/** IANA TZ identifier for our operating region. */
export const APP_TZ = "America/Los_Angeles";

/**
 * Returns the current ISO date (YYYY-MM-DD) as observed in Pacific
 * time, regardless of the runtime's actual timezone.
 */
export function todayPacificISO(): string {
  return pacificISO(new Date());
}

/** Get an ISO date for an arbitrary Date in Pacific time. */
export function pacificISO(d: Date): string {
  // en-CA's locale returns YYYY-MM-DD natively from formatToParts.
  // Using `toLocaleDateString` with the right options is the most
  // portable way to format a Date in a specific TZ without pulling
  // in a date library.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value ?? "0000";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${day}`;
}

/** Returns today's pieces (year, month, day) in Pacific. */
export function pacificYMD(d: Date = new Date()): {
  year: number;
  month: number; // 1–12
  day: number;
} {
  const iso = pacificISO(d);
  const [y, m, day] = iso.split("-").map(Number);
  return { year: y, month: m, day };
}

/**
 * Add N days to an ISO date (YYYY-MM-DD) and return the result as
 * another ISO date. Operates on the calendar date directly so it
 * never drifts across DST transitions.
 */
export function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Friendly weekday/month label for a given Date, in Pacific. */
export function pacificDateLabel(
  d: Date,
  opts: Intl.DateTimeFormatOptions = {
    weekday: "long",
    month: "short",
    day: "numeric",
  },
): string {
  return d.toLocaleDateString("en-US", { timeZone: APP_TZ, ...opts });
}

/**
 * Format an ISO date (YYYY-MM-DD) or Date object as mm/dd/yy.
 * Always zero-padded — the company convention is to read dates in that
 * fixed-width form so columns line up.
 *
 * Returns "—" for null/undefined/empty so callers can drop the
 * fallback they used to write inline.
 */
export function formatMDY(value: string | Date | null | undefined): string {
  if (!value) return "—";
  let y: number, m: number, d: number;
  if (value instanceof Date) {
    const iso = pacificISO(value);
    [y, m, d] = iso.split("-").map(Number);
  } else {
    // Plain ISO 'YYYY-MM-DD' (or a timestamp string — slice off the date).
    const datePart = String(value).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return String(value);
    [y, m, d] = datePart.split("-").map(Number);
  }
  const yy = String(y).padStart(4, "0").slice(-2);
  return `${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}/${yy}`;
}

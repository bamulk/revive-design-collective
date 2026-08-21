import "server-only";

/**
 * Sacramento-metro "median days to pending" from Zillow Research's
 * public CSV (updated monthly, ~300KB, no API key). Fetched through
 * Next's data cache with a 24h revalidate so the dashboard never
 * waits on Zillow more than once a day per server.
 */
const CSV_URL =
  "https://files.zillowstatic.com/research/public_csvs/med_doz_pending/Metro_med_doz_pending_uc_sfrcondo_sm_month.csv";
/** RegionID for the "Sacramento, CA" msa row — stable across updates. */
const SACRAMENTO_REGION_ID = "395045";
/** Header columns before the monthly data begins. */
const META_COLUMNS = 5; // RegionID, SizeRank, RegionName, RegionType, StateName

export type DomPoint = {
  /** "YYYY-MM" */
  month: string;
  days: number;
};

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export async function fetchSacramentoDom(
  months = 24,
): Promise<DomPoint[] | null> {
  try {
    const res = await fetch(CSV_URL, { next: { revalidate: 86400 } });
    if (!res.ok) return null;
    const text = await res.text();
    const lines = text.split(/\r?\n/);
    const header = splitCsvLine(lines[0] ?? "");
    const row = lines.find((l) => l.startsWith(`${SACRAMENTO_REGION_ID},`));
    if (!row) return null;
    const cells = splitCsvLine(row);

    const out: DomPoint[] = [];
    for (let i = META_COLUMNS; i < header.length && i < cells.length; i++) {
      const month = header[i]?.slice(0, 7);
      const days = Number(cells[i]);
      if (/^\d{4}-\d{2}$/.test(month ?? "") && Number.isFinite(days) && days > 0) {
        out.push({ month: month!, days });
      }
    }
    return out.length >= 2 ? out.slice(-months) : null;
  } catch (e) {
    console.error("[market-dom] fetch/parse failed:", e);
    return null;
  }
}

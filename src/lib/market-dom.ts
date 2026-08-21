import "server-only";

/**
 * Sacramento-metro "days from listing to closed" built from two Zillow
 * Research public CSVs (monthly, ~300KB each, no API key):
 *
 *   median days to pending  (listing → accepted offer)
 * + mean days to close      (accepted offer → closed)
 * = days till closed
 *
 * Both fetched through Next's data cache with a 24h revalidate so the
 * dashboard never waits on Zillow more than once a day per server.
 */
const PENDING_CSV =
  "https://files.zillowstatic.com/research/public_csvs/med_doz_pending/Metro_med_doz_pending_uc_sfrcondo_sm_month.csv";
const CLOSE_CSV =
  "https://files.zillowstatic.com/research/public_csvs/mean_days_to_close/Metro_mean_days_to_close_uc_sfrcondo_sm_month.csv";
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

/** One Zillow metro CSV → Sacramento's monthly series as a Map. */
async function fetchSacramentoSeries(
  url: string,
): Promise<Map<string, number> | null> {
  try {
    const res = await fetch(url, { next: { revalidate: 86400 } });
    if (!res.ok) return null;
    const text = await res.text();
    const lines = text.split(/\r?\n/);
    const header = splitCsvLine(lines[0] ?? "");
    const row = lines.find((l) => l.startsWith(`${SACRAMENTO_REGION_ID},`));
    if (!row) return null;
    const cells = splitCsvLine(row);
    const out = new Map<string, number>();
    for (let i = META_COLUMNS; i < header.length && i < cells.length; i++) {
      const month = header[i]?.slice(0, 7);
      const v = Number(cells[i]);
      if (/^\d{4}-\d{2}$/.test(month ?? "") && Number.isFinite(v) && v > 0) {
        out.set(month!, v);
      }
    }
    return out.size >= 2 ? out : null;
  } catch (e) {
    console.error("[market-dom] fetch/parse failed:", url, e);
    return null;
  }
}

/**
 * Days from listing to closed, last `months` months (only months
 * present in BOTH source series). Null if either feed is unavailable.
 */
export async function fetchSacramentoDaysToClosed(
  months = 24,
): Promise<DomPoint[] | null> {
  const [pending, close] = await Promise.all([
    fetchSacramentoSeries(PENDING_CSV),
    fetchSacramentoSeries(CLOSE_CSV),
  ]);
  if (!pending || !close) return null;
  const out: DomPoint[] = [];
  for (const [month, toPending] of pending) {
    const toClose = close.get(month);
    if (toClose == null) continue;
    out.push({ month, days: Math.round(toPending + toClose) });
  }
  out.sort((a, b) => a.month.localeCompare(b.month));
  return out.length >= 2 ? out.slice(-months) : null;
}

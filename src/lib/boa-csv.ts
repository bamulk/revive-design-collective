// Parser for Bank of America activity exports.
//
// BoA gives you a few shapes depending on how you grab the data:
//
//   - "Download → Comma Delimited" — true CSV with a header row:
//     Date,Description,Amount,Running Bal.
//
//   - "Download → Tab Delimited" — same columns, tab-separated, often
//     with no header row when you copy directly from the page:
//     1/2/26\tSHELL OIL 57443474804 12/30 PURCHASE ELK GROVE CA DEBIT CARD *7835\t-63.69\t1,196.59
//
//   - The newer "Posted Date,Reference Number,Payee,Address,Amount"
//     layout is also out there for some account types.
//
// We auto-detect the delimiter per line, find a header row if one
// exists, and fall back to a positional [date, description, amount,
// balance?] assumption when there's no header. Negative amounts are
// imported as expenses; positives are skipped (income comes from
// stages.paid_at).

export type ParsedRow = {
  /** ISO yyyy-mm-dd */
  date: string;
  description: string;
  /** Always positive; the sign was already stripped. */
  amount: number;
  /** Bank's own reference id if present, used for dedupe across imports. */
  externalId?: string;
};

export type ParseResult = {
  rows: ParsedRow[];
  skipped: { credits: number; unparseable: number };
};

function detectDelimiter(line: string): "\t" | "," {
  if (line.includes("\t")) return "\t";
  return ",";
}

function splitCommaLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function splitLine(line: string, delim: "\t" | ","): string[] {
  if (delim === "\t") {
    // Tabs aren't quoted, so a plain split is fine — but strip quotes
    // that some clipboards add around individual cells.
    return line.split("\t").map((s) => s.trim().replace(/^"|"$/g, ""));
  }
  return splitCommaLine(line);
}

function parseAmount(raw: string): number | null {
  if (!raw) return null;
  // Strip commas (thousands sep), quotes, currency symbols, whitespace.
  // Normalize unicode minus to ASCII.
  const cleaned = raw
    .replace(/["'$\s,]/g, "")
    .replace(/[−–—]/g, "-");
  if (cleaned === "" || cleaned === "-") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseDate(raw: string): string | null {
  if (!raw) return null;
  const s = raw.replace(/["']/g, "").trim();
  // M/D/YY, M/D/YYYY, MM/DD/YYYY
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) {
    let [, m, d, y] = slash;
    if (y.length === 2) y = (Number(y) > 70 ? "19" : "20") + y;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const ts = Date.parse(s);
  if (Number.isFinite(ts)) {
    const dt = new Date(ts);
    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const d = String(dt.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return null;
}

/**
 * Tries to figure out which columns hold what, either by reading the
 * header row or by guessing from positional layout. Returns null if
 * we can't pin down date + amount.
 */
function inferColumns(
  cells: string[],
  hasHeader: boolean
): {
  dateIdx: number;
  amountIdx: number;
  descIdx: number;
  refIdx: number;
} | null {
  if (hasHeader) {
    const headers = cells.map((c) => c.toLowerCase());
    const find = (...names: string[]) =>
      headers.findIndex((h) => names.some((n) => h.includes(n)));
    const dateIdx = find("posted date", "transaction date", "date");
    const amountIdx = find("amount");
    const descIdx = find("payee", "description", "merchant");
    const refIdx = find("reference number", "reference", "transaction id");
    if (dateIdx === -1 || amountIdx === -1) return null;
    return { dateIdx, amountIdx, descIdx, refIdx };
  }
  // No header — assume positional: date, description, amount, [running bal]
  if (cells.length < 3) return null;
  return { dateIdx: 0, descIdx: 1, amountIdx: 2, refIdx: -1 };
}

/**
 * Parses a Bank of America Activity export (CSV or TSV, with or
 * without a header row) and returns the outflow rows.
 */
export function parseBankOfAmericaCsv(csv: string): ParseResult {
  const rawLines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (rawLines.length === 0) {
    return { rows: [], skipped: { credits: 0, unparseable: 0 } };
  }

  const delim = detectDelimiter(rawLines[0]);

  // Try to find a header in the first few rows.
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rawLines.length, 20); i++) {
    const cells = splitLine(rawLines[i], delim).map((c) => c.toLowerCase());
    if (
      cells.some((c) => c.includes("date")) &&
      cells.some((c) => c.includes("amount"))
    ) {
      headerIdx = i;
      break;
    }
  }

  const hasHeader = headerIdx >= 0;
  const cols = hasHeader
    ? inferColumns(splitLine(rawLines[headerIdx], delim), true)
    : inferColumns(splitLine(rawLines[0], delim), false);
  if (!cols) {
    return {
      rows: [],
      skipped: { credits: 0, unparseable: rawLines.length },
    };
  }

  const startIdx = hasHeader ? headerIdx + 1 : 0;
  const out: ParsedRow[] = [];
  let credits = 0;
  let unparseable = 0;

  for (let i = startIdx; i < rawLines.length; i++) {
    const cells = splitLine(rawLines[i], delim);
    if (cells.length < 2) {
      unparseable++;
      continue;
    }
    const date = parseDate(cells[cols.dateIdx] ?? "");
    const amount = parseAmount(cells[cols.amountIdx] ?? "");
    const description = (cols.descIdx >= 0 ? cells[cols.descIdx] : "").trim();
    if (!date || amount === null || !description) {
      unparseable++;
      continue;
    }
    // BoA expresses outflows as negative.
    if (amount >= 0) {
      credits++;
      continue;
    }
    out.push({
      date,
      description,
      amount: Math.abs(amount),
      externalId:
        cols.refIdx >= 0 ? cells[cols.refIdx]?.trim() || undefined : undefined,
    });
  }

  return { rows: out, skipped: { credits, unparseable } };
}

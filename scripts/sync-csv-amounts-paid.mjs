#!/usr/bin/env node
/**
 * Sync amount + paid_at onto existing stages from a CSV.
 *
 *   node scripts/sync-csv-amounts-paid.mjs <csv-path>          — dry run, no writes
 *   node scripts/sync-csv-amounts-paid.mjs <csv-path> --apply  — apply updates
 *
 * Expected CSV columns (header row required):
 *   Address, Stage Date, Amount, Paid, Extension Amount
 *
 * Matching strategy (each row tried in order, first hit wins):
 *   1. Normalized full address + exact stage_date.
 *   2. Normalized full address + stage_date within +/- 3 days
 *      (covers data-entry drift between systems).
 *   3. Street number + first significant street word + stage_date.
 *
 * Address normalization lowercases everything, strips punctuation,
 * collapses whitespace, and rewrites common abbreviations (Ave ->
 * Avenue, Dr -> Drive, Rd -> Road, St -> Street, Ct -> Court, Ln ->
 * Lane, Cir -> Circle, Pl -> Place, Pkwy -> Parkway, Blvd ->
 * Boulevard).
 *
 * On --apply, for each matched row:
 *   - stages.amount      <- CSV amount (only if CSV amount > 0)
 *   - stages.paid_at     <- stage_date (only if Paid in {Yes, Not Needed}
 *                          AND stages.paid_at IS NULL)
 *
 * Ambiguous matches (multiple DB candidates) are surfaced in the
 * report and skipped — better to leave alone than to mis-update.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

// ---- env -----------------------------------------------------------

function readDotEnv() {
  const envPath = path.resolve(".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    if (!process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
readDotEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

// ---- args ----------------------------------------------------------

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const csvPath = args.find((a) => !a.startsWith("--"));
if (!csvPath) {
  console.error(
    "Usage: node scripts/sync-csv-amounts-paid.mjs <csv-path> [--apply]",
  );
  process.exit(1);
}

// ---- csv parsing ---------------------------------------------------

/**
 * Tiny CSV parser handling quoted fields with embedded commas.
 * Returns array of arrays.
 */
function parseCSV(text) {
  const out = [];
  let row = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") {
        row.push(cur);
        cur = "";
      } else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(cur);
        cur = "";
        out.push(row);
        row = [];
      } else cur += ch;
    }
  }
  if (cur.length > 0 || row.length > 0) {
    row.push(cur);
    out.push(row);
  }
  return out;
}

function parseAmount(s) {
  if (!s) return null;
  const cleaned = String(s).replace(/[$,]/g, "").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseDate(s) {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) return null;
  let [, mm, dd, yy] = m;
  if (yy.length === 2) yy = `20${yy}`;
  return `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

// ---- normalization ------------------------------------------------

const STREET_ABBREVS = [
  ["avenue", /\bave\.?\b/g],
  ["drive", /\bdr\.?\b/g],
  ["road", /\brd\.?\b/g],
  ["street", /\bst\.?\b/g],
  ["court", /\bct\.?\b/g],
  ["lane", /\bln\.?\b/g],
  ["circle", /\bcir\.?\b/g],
  ["place", /\bpl\.?\b/g],
  ["parkway", /\bpkwy\.?\b/g],
  ["boulevard", /\bblvd\.?\b/g],
  ["highway", /\bhwy\.?\b/g],
  ["terrace", /\bter\.?\b/g],
  ["square", /\bsq\.?\b/g],
];

function normalizeAddress(raw) {
  if (!raw) return "";
  let s = String(raw).toLowerCase();
  s = s.replace(/[#\.,]/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  for (const [full, re] of STREET_ABBREVS) {
    s = s.replace(re, full);
  }
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

// First significant street word after the street number — used as a
// fuzzy fallback when full-string match fails.
function streetSignature(raw) {
  const norm = normalizeAddress(raw);
  const tokens = norm.split(" ").filter(Boolean);
  if (tokens.length < 2) return null;
  // Skip leading numeric tokens (street number, unit qualifiers).
  let i = 0;
  while (i < tokens.length && /^[\d]+[a-z]?$/i.test(tokens[i])) i++;
  if (i >= tokens.length) return null;
  return { number: tokens[0], word: tokens[i] };
}

function daysApart(a, b) {
  if (!a || !b) return Infinity;
  const da = new Date(`${a}T00:00:00Z`).getTime();
  const db = new Date(`${b}T00:00:00Z`).getTime();
  return Math.abs(da - db) / 86400000;
}

// ---- main ----------------------------------------------------------

async function main() {
  const csvText = fs.readFileSync(csvPath, "utf8");
  const rows = parseCSV(csvText);
  if (rows.length < 2) {
    console.error("CSV is empty");
    process.exit(1);
  }
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idxAddr = header.indexOf("address");
  const idxDate = header.indexOf("stage date");
  const idxAmt = header.indexOf("amount");
  const idxPaid = header.indexOf("paid");
  if (idxAddr < 0 || idxDate < 0 || idxAmt < 0 || idxPaid < 0) {
    console.error(
      "CSV must include Address, Stage Date, Amount, Paid columns. Got:",
      header,
    );
    process.exit(1);
  }

  // Load all stages we might match against.
  const { data: stages, error } = await supabase
    .from("stages")
    .select("id, address, city, stage_date, amount, paid_at, status")
    .neq("status", "estimate")
    .limit(10000);
  if (error) {
    console.error("Supabase query failed:", error.message);
    process.exit(1);
  }

  // Pre-compute normalized forms for each stage.
  const stageIndex = stages.map((s) => {
    const combo = [s.address, s.city].filter(Boolean).join(" ");
    return {
      ...s,
      norm: normalizeAddress(combo),
      sig: streetSignature(s.address ?? ""),
    };
  });

  const report = {
    matched: 0,
    matchedNoChange: 0,
    ambiguous: 0,
    unmatched: 0,
    skippedBlank: 0,
  };
  const updates = []; // [{ id, before, after, csvIdx }]
  const ambiguous = [];
  const unmatched = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const csvAddr = (row[idxAddr] || "").trim();
    const csvDate = parseDate(row[idxDate]);
    const csvAmt = parseAmount(row[idxAmt]);
    const csvPaid = (row[idxPaid] || "").trim().toLowerCase();
    if (!csvAddr || !csvDate) {
      report.skippedBlank++;
      continue;
    }
    const normCsv = normalizeAddress(csvAddr);
    const sigCsv = streetSignature(csvAddr);

    // Pass 1 — normalized address + exact date.
    let candidates = stageIndex.filter(
      (s) => s.norm === normCsv && s.stage_date === csvDate,
    );
    // Pass 2 — normalized address + date within +/- 3 days.
    if (candidates.length === 0) {
      candidates = stageIndex.filter(
        (s) => s.norm === normCsv && daysApart(s.stage_date, csvDate) <= 3,
      );
    }
    // Pass 3 — street number + first word + same date.
    if (candidates.length === 0 && sigCsv) {
      candidates = stageIndex.filter(
        (s) =>
          s.sig &&
          s.sig.number === sigCsv.number &&
          s.sig.word === sigCsv.word &&
          s.stage_date === csvDate,
      );
    }
    // Pass 4 — normalized address only (any date) — only if exactly one.
    if (candidates.length === 0) {
      const looser = stageIndex.filter((s) => s.norm === normCsv);
      if (looser.length === 1) candidates = looser;
    }

    if (candidates.length === 0) {
      report.unmatched++;
      unmatched.push({ csvIdx: r + 1, csvAddr, csvDate, csvAmt, csvPaid });
      continue;
    }
    if (candidates.length > 1) {
      report.ambiguous++;
      ambiguous.push({
        csvIdx: r + 1,
        csvAddr,
        csvDate,
        matches: candidates.map((c) => ({
          id: c.id,
          address: c.address,
          city: c.city,
          stage_date: c.stage_date,
        })),
      });
      continue;
    }

    const stage = candidates[0];
    const before = {
      amount: stage.amount == null ? null : Number(stage.amount),
      paid_at: stage.paid_at,
    };
    const after = { amount: before.amount, paid_at: before.paid_at };

    if (csvAmt != null && csvAmt > 0 && csvAmt !== before.amount) {
      after.amount = csvAmt;
    }
    const paidPositive =
      csvPaid === "yes" || csvPaid === "not needed";
    if (paidPositive && before.paid_at == null) {
      // Stamp paid_at as the stage_date (best-fit historical date).
      after.paid_at = stage.stage_date;
    }

    if (
      after.amount === before.amount &&
      after.paid_at === before.paid_at
    ) {
      report.matchedNoChange++;
      continue;
    }

    report.matched++;
    updates.push({
      id: stage.id,
      address: stage.address,
      stage_date: stage.stage_date,
      before,
      after,
    });
  }

  // ---- report -----------------------------------------------------

  console.log(`\nCSV rows: ${rows.length - 1}`);
  console.log(`Matched (will update):       ${report.matched}`);
  console.log(`Matched (already up-to-date): ${report.matchedNoChange}`);
  console.log(`Ambiguous (multiple hits, skipped): ${report.ambiguous}`);
  console.log(`Unmatched: ${report.unmatched}`);
  console.log(`Blank/skipped CSV rows: ${report.skippedBlank}`);
  console.log();

  if (updates.length > 0) {
    console.log("--- Updates (first 25) ---");
    for (const u of updates.slice(0, 25)) {
      const a =
        u.before.amount === u.after.amount
          ? ""
          : ` amount ${u.before.amount} -> ${u.after.amount}`;
      const p =
        u.before.paid_at === u.after.paid_at
          ? ""
          : ` paid_at ${u.before.paid_at ?? "null"} -> ${u.after.paid_at ?? "null"}`;
      console.log(`  ${u.address} (${u.stage_date}) ${a}${p}`);
    }
    if (updates.length > 25) {
      console.log(`  ... and ${updates.length - 25} more`);
    }
    console.log();
  }
  if (ambiguous.length > 0) {
    console.log("--- Ambiguous (first 10) ---");
    for (const a of ambiguous.slice(0, 10)) {
      console.log(
        `  CSV row ${a.csvIdx}: "${a.csvAddr}" (${a.csvDate}) matches ${a.matches.length} stages`,
      );
      for (const m of a.matches.slice(0, 3)) {
        console.log(`    - ${m.id}: ${m.address} | ${m.city} | ${m.stage_date}`);
      }
    }
    console.log();
  }
  if (unmatched.length > 0) {
    console.log("--- Unmatched (first 20) ---");
    for (const u of unmatched.slice(0, 20)) {
      console.log(`  CSV row ${u.csvIdx}: "${u.csvAddr}" (${u.csvDate})`);
    }
    if (unmatched.length > 20) {
      console.log(`  ... and ${unmatched.length - 20} more`);
    }
    console.log();
  }

  if (!apply) {
    console.log("Dry run — re-run with --apply to write the updates.");
    return;
  }

  // ---- apply ------------------------------------------------------

  console.log(`Applying ${updates.length} updates...`);
  let ok = 0;
  let failed = 0;
  for (const u of updates) {
    const patch = {};
    if (u.after.amount !== u.before.amount) patch.amount = u.after.amount;
    if (u.after.paid_at !== u.before.paid_at) patch.paid_at = u.after.paid_at;
    const { error } = await supabase
      .from("stages")
      .update(patch)
      .eq("id", u.id);
    if (error) {
      failed++;
      console.error(`  FAIL ${u.id} (${u.address}): ${error.message}`);
    } else {
      ok++;
    }
  }
  console.log(`\nDone. ${ok} ok, ${failed} failed.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

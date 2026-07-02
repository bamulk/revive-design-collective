#!/usr/bin/env node
/**
 * Preview-only sync from the Google Sheet "Revive Design Collective" payment log.
 *
 *   node scripts/sync-sheet-preview.mjs            — dry run, no writes
 *   node scripts/sync-sheet-preview.mjs --apply    — actually write changes
 *
 * Sheet columns (in order):
 *   address (unlabeled first column)
 *   Date Staged | Amount Paid | Sent invoice? | Paid | Extension Amount
 *   Client | Destage Date | Move to Completed | CR Due | Closing date | Notes
 *
 * For each row we:
 *   1. Fuzzy-match against stages.address using a normalized form
 *      ("St" / "Street" / case / punctuation tolerant).
 *   2. Compare sheet values against DB values.
 *   3. Print a per-field diff. NO WRITES until --apply.
 *
 * Apply rules (when --apply is set):
 *   - Only fields that are clearly different get written.
 *   - amount/destage_date/notes only update if the sheet value is
 *     present (we don't overwrite app data with blanks).
 *   - Paid=Yes → set paid_at to the destage date when available,
 *     else stage_date, else today. Skip if the stage is already paid.
 *   - Sent invoice?=Yes → set invoice_sent_at to destage/stage date
 *     if it's currently null.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const SHEET_ID = "1Lfl92mNiOCerlPDjNSDYPzRSaluNG1WvJTDGGXYBG8Q";
const SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`;

/**
 * Manual address → stage_id overrides for sheet rows that the
 * normalizer can't match (typos, missing city qualifiers, ambiguous
 * cases the user has already disambiguated). Keys are the lowercase
 * raw sheet address; values are stage UUIDs.
 *
 * Entries explicitly NOT mapped (intentional skips):
 *   - "11150 Trinity River #126 Rancho Cordova" → DB has #136 (different unit)
 *   - "551 Southgate Road Sacramento" → already covered by another sheet row
 */
const ADDRESS_OVERRIDES = {
  "8541 still woods court south sacramento": "1ea05ccd-3a54-4d04-ad4c-9a2a2712d025",
  "330 tenaya": "8496bfc3-e777-4a56-8207-73fc3fa31232",
  "6211 14th street sacramento": "5d48ebd5-19b2-4d57-8462-1dc5d6bfa280",
  "628 42nd street sacramento": "4891eaf7-61b1-4415-bfe2-e2af67d27302",
  "1713 pennsylvania avenue sacramento": "1b8e6e06-77ba-4668-8ee5-3cfb421c5b62",
  "3031 melina drive el dorado hills": "a8a315e3-7788-4f7c-ac43-6daccda54af7",
  "5416 north avenue carmichael": "c726312b-f356-4cd3-b284-537e7c6fc288",
  "3110 pender island sacramento": "a7f7de61-9edd-47d4-ae0b-00141a3689b4",
  "2778 marlin street sacramento": "da5618f5-34cc-4590-9a20-e3c4db4789d4",
  "20815 adeline drive colfax": "7e7f8b6a-2bf8-47b7-84cf-70d3a909fa9a",
  "123 circuit drive #a roseville": "d60d9b99-94b6-46e5-a1b0-7d8312886fd0",
  "3900 green forest sacramento": "b65d3158-e905-43da-bc5e-e9d890800d63",
  "327 22nd street downtown": "da100fc4-dbc1-43f7-9fcb-ca4439fcd051",
  "3224 casitas bonito sacramento": "9acf1392-4edd-46e1-a59f-4ac8b830cf44",
  "15 bristle bark plaza natomas": "f86f77d7-6625-4558-8401-8dc76f763ab6",
  "2812 pintail court west sacramento": "946399e7-c057-4bba-9f36-30fe485032d0",
  "3302 19th ave sacramento": "163d6aad-ffe3-4088-b4d3-8d0843e98949",
  "4200 e commerce way # 2512 sacramento": "aa91f847-04bb-4ad5-a2c3-0491f89ce8fb",
  "3201 montrose way edh": "9e8daaf0-2982-46ae-bbee-3ad6e076b053",
  "8367 midland road gb": "81748b85-8e5a-444f-bda3-74d8e495336b",
  "2565 14th street sac": "a3a16e79-b7c2-4c5d-849d-3819fd567e19",
  "3217 43rd street sac": "13ce1c8a-7059-4cac-a2f8-89910cb693b8",
};

// ---- env loading -----------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(__dirname, "..", ".env.local"), "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing Supabase env vars");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ---- CSV parsing -----------------------------------------------------------
/** Minimal CSV parser that handles quoted fields with embedded commas. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// ---- Normalizers -----------------------------------------------------------
/** Normalize an address so 'Rd' / 'Road', case, punctuation all match. */
function normalizeAddress(s) {
  if (!s) return "";
  return s
    .toLowerCase()
    .replace(/[.,#]/g, " ")
    .replace(/\bstreet\b/g, "st")
    .replace(/\bavenue\b/g, "ave")
    .replace(/\bboulevard\b/g, "blvd")
    .replace(/\broad\b/g, "rd")
    .replace(/\bdrive\b/g, "dr")
    .replace(/\bcourt\b/g, "ct")
    .replace(/\blane\b/g, "ln")
    .replace(/\bplace\b/g, "pl")
    .replace(/\bcircle\b/g, "cir")
    .replace(/\bparkway\b/g, "pkwy")
    .replace(/\bway\b/g, "way")
    .replace(/\s+/g, " ")
    .trim();
}

function parseDollar(s) {
  if (!s) return null;
  const n = Number(String(s).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Parse a 'M/D/YYYY' style date into 'YYYY-MM-DD'. Returns null on garbage. */
function parseDate(s) {
  if (!s) return null;
  const trimmed = String(s).trim();
  if (!trimmed) return null;
  // already ISO?
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const m = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  let [, mm, dd, yy] = m;
  if (yy.length === 2) yy = "20" + yy;
  return `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

function yesNo(s) {
  return /^y(es)?$/i.test(String(s || "").trim());
}

// ---- Main ------------------------------------------------------------------
async function main() {
  console.log("[sheet-sync] fetching CSV…");
  const res = await fetch(SHEET_CSV_URL);
  if (!res.ok) {
    console.error(`Sheet fetch failed: ${res.status}`);
    process.exit(1);
  }
  const csv = await res.text();
  const allRows = parseCsv(csv);
  const header = allRows[0];
  const rows = allRows
    .slice(1)
    .filter((r) => (r[0] || "").trim().length > 0);
  console.log(`[sheet-sync] ${rows.length} data rows (header: ${header.length} cols)`);

  // Column indices — guard against the sheet being reordered.
  const col = {
    address: 0,
    dateStaged: header.indexOf("Date Staged"),
    amountPaid: header.indexOf("Amount Paid"),
    sentInvoice: header.indexOf("Sent invoice?"),
    paid: header.indexOf("Paid"),
    extension: header.indexOf("Extension Amount"),
    client: header.indexOf("Client"),
    destageDate: header.indexOf("Destage Date"),
    notes: header.indexOf("Notes"),
  };

  // Pull every stage so we can match by normalized address.
  console.log("[sheet-sync] loading stages…");
  const stagesByAddr = new Map(); // normAddr -> [stage,...]
  const stagesById = new Map();
  let from = 0;
  const PAGE = 1000;
  let totalLoaded = 0;
  while (true) {
    const { data: chunk, error } = await supabase
      .from("stages")
      .select(
        "id, address, status, stage_date, destage_date, amount, paid_at, invoice_sent_at, notes",
      )
      .neq("status", "estimate")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    for (const s of chunk) {
      const key = normalizeAddress(s.address);
      if (!stagesByAddr.has(key)) stagesByAddr.set(key, []);
      stagesByAddr.get(key).push(s);
      stagesById.set(s.id, s);
    }
    totalLoaded += chunk.length;
    if (chunk.length < PAGE) break;
    from += PAGE;
  }
  console.log(`[sheet-sync] loaded ${totalLoaded} stages (${stagesByAddr.size} unique addresses)`);

  // ---- Per-row analysis ----
  let matched = 0;
  let multipleMatches = 0;
  let unmatched = 0;
  let writes = 0;
  let writesAppliedRows = 0;
  const unmatchedList = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const sheetAddr = (r[col.address] || "").trim();

    // 1. Manual override has highest priority.
    let candidates = [];
    const overrideId = ADDRESS_OVERRIDES[sheetAddr.toLowerCase()];
    if (overrideId) {
      const s = stagesById.get(overrideId);
      if (s) candidates = [s];
    }
    // 2. Fall back to normalized fuzzy match.
    if (candidates.length === 0) {
      const norm = normalizeAddress(sheetAddr);
      candidates = stagesByAddr.get(norm) || [];
    }

    if (candidates.length === 0) {
      unmatched += 1;
      unmatchedList.push(sheetAddr);
      continue;
    }
    if (candidates.length > 1) {
      multipleMatches += 1;
    }
    matched += 1;
    const stage = candidates[0]; // first match wins

    // Pull sheet values
    const sheetAmount = (() => {
      const base = parseDollar(r[col.amountPaid]) ?? 0;
      const ext = parseDollar(r[col.extension]) ?? 0;
      return base + ext || null;
    })();
    const sheetStageDate = parseDate(r[col.dateStaged]);
    const sheetDestageDate = parseDate(r[col.destageDate]);
    const sheetPaid = yesNo(r[col.paid]);
    const sheetSentInvoice = yesNo(r[col.sentInvoice]);
    const sheetNotes = (r[col.notes] || "").trim();

    // Build per-field diffs (only when value differs and sheet has data).
    const changes = {};
    if (
      sheetAmount != null &&
      Math.abs(Number(stage.amount ?? 0) - sheetAmount) > 0.01
    ) {
      changes.amount = { from: Number(stage.amount ?? 0), to: sheetAmount };
    }
    if (sheetStageDate && stage.stage_date !== sheetStageDate) {
      changes.stage_date = { from: stage.stage_date, to: sheetStageDate };
    }
    if (sheetDestageDate && stage.destage_date !== sheetDestageDate) {
      changes.destage_date = { from: stage.destage_date, to: sheetDestageDate };
    }
    if (sheetPaid && !stage.paid_at) {
      const paidStamp =
        sheetDestageDate ||
        stage.destage_date ||
        sheetStageDate ||
        stage.stage_date ||
        new Date().toISOString().slice(0, 10);
      changes.paid_at = { from: null, to: paidStamp };
    }
    if (sheetSentInvoice && !stage.invoice_sent_at) {
      const sentStamp =
        sheetDestageDate ||
        stage.destage_date ||
        sheetStageDate ||
        stage.stage_date ||
        new Date().toISOString().slice(0, 10);
      changes.invoice_sent_at = { from: null, to: `${sentStamp}T00:00:00Z` };
    }
    if (sheetNotes && stage.notes !== sheetNotes && !stage.notes) {
      // Only add notes if the DB row is empty — never clobber existing notes.
      changes.notes = { from: stage.notes, to: sheetNotes };
    }

    const keys = Object.keys(changes);
    if (keys.length === 0) continue;

    console.log(`\n[row ${i + 2}] ${sheetAddr}`);
    console.log(`  stage: ${stage.id}  (${stage.address})`);
    if (candidates.length > 1) {
      console.log(`  ⚠ ${candidates.length} stages share this address — picking the first`);
    }
    for (const k of keys) {
      console.log(`  ${k}: ${fmt(changes[k].from)} → ${fmt(changes[k].to)}`);
    }
    writes += keys.length;

    if (APPLY) {
      const payload = {};
      for (const k of keys) payload[k] = changes[k].to;
      const { error } = await supabase
        .from("stages")
        .update(payload)
        .eq("id", stage.id);
      if (error) {
        console.error(`  ✗ update failed: ${error.message}`);
      } else {
        writesAppliedRows += 1;
      }
    }
  }

  console.log("\n=== Summary ===");
  console.log(`Sheet rows:               ${rows.length}`);
  console.log(`Matched to a stage:       ${matched}`);
  console.log(`Matched to multiple:      ${multipleMatches}`);
  console.log(`No DB match:              ${unmatched}`);
  console.log(`Field changes available:  ${writes}`);
  if (APPLY) {
    console.log(`Rows actually updated:    ${writesAppliedRows}`);
  } else {
    console.log("Mode: PREVIEW (no writes). Re-run with --apply to commit.");
  }
  if (unmatchedList.length) {
    console.log("\nUnmatched sheet addresses:");
    for (const a of unmatchedList) console.log("  -", a);
  }
}

function fmt(v) {
  if (v == null) return "—";
  if (typeof v === "number") return v.toFixed(2);
  return String(v);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

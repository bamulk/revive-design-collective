#!/usr/bin/env node
/**
 * Preview-only sync from the FreshBooks CSV export of client info.
 *
 *   node scripts/sync-freshbooks-preview.mjs            — dry run, no writes
 *   node scripts/sync-freshbooks-preview.mjs --apply    — actually write
 *
 * Match strategy:
 *   - Primary key is the contact's display name (Organization wins
 *     over First+Last when both are set).
 *   - Normalized matching (lowercase, whitespace-collapsed, common
 *     suffixes like " LLC" stripped) so "Cap City Construction" and
 *     "Cap City Construction LLC" merge into the same record.
 *   - Rows without a name (FreshBooks stores additional emails as
 *     standalone rows under the same client) are skipped — we only
 *     keep the primary email/phone for each client.
 *
 * Safety:
 *   - Email/phone are only WRITTEN if the DB column is currently empty
 *     OR the CSV value is identical-ish. Conflicts (existing value ≠
 *     CSV value) are flagged but NOT overwritten. Re-run with the
 *     --force-email or --force-phone flag if you want to overwrite.
 *   - New clients are NOT created. Only existing client rows are
 *     updated. Unmatched FreshBooks rows are listed at the end.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const FORCE_EMAIL = process.argv.includes("--force-email");
const FORCE_PHONE = process.argv.includes("--force-phone");
const FRESHBOOKS_CSV = "/Users/brettmulkey/Downloads/FreshBooks Clients.csv";

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
const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

// ---- CSV parsing -----------------------------------------------------------
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
      } else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else field += c;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// ---- Normalizers -----------------------------------------------------------
function normalizeName(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[.,'’]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*(llc|inc|co|corp|properties|realty)\.?\s*$/, "")
    .trim();
}

function cleanPhone(raw) {
  if (!raw) return null;
  // FreshBooks/Excel often prefixes phone with ' to force text mode.
  const trimmed = String(raw).replace(/^'/, "").trim();
  return trimmed || null;
}

function cleanEmail(raw) {
  if (!raw) return null;
  return String(raw).trim().toLowerCase() || null;
}

/** Build the "display name" for a FreshBooks row. */
function displayName(row) {
  const org = (row[0] || "").trim();
  const first = (row[1] || "").trim();
  const last = (row[2] || "").trim();
  if (org) return org;
  const person = `${first} ${last}`.trim();
  return person || null;
}

// ---- Main ------------------------------------------------------------------
async function main() {
  if (!fs.existsSync(FRESHBOOKS_CSV)) {
    console.error(`Couldn't find CSV at ${FRESHBOOKS_CSV}`);
    process.exit(1);
  }

  console.log(`[freshbooks-sync] reading ${FRESHBOOKS_CSV}`);
  const csv = fs.readFileSync(FRESHBOOKS_CSV, "utf8");
  const rows = parseCsv(csv);
  rows.shift(); // header

  // Group rows by display name. Take the first row's email/phone as
  // canonical (FreshBooks puts the primary email on the named row and
  // alternates on nameless rows underneath).
  const byName = new Map(); // name -> { name, email, phone }
  let skippedNameless = 0;
  for (const row of rows) {
    const name = displayName(row);
    if (!name) {
      skippedNameless += 1;
      continue;
    }
    if (byName.has(name)) continue; // first occurrence wins
    byName.set(name, {
      name,
      email: cleanEmail(row[3]),
      phone: cleanPhone(row[4]),
    });
  }
  console.log(`[freshbooks-sync] ${byName.size} named contacts (${skippedNameless} nameless email-only rows ignored)`);

  // Load all existing clients keyed by normalized name.
  console.log("[freshbooks-sync] loading clients…");
  const clientsByNorm = new Map();
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data: chunk, error } = await supabase
      .from("clients")
      .select("id, name, email, phone")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    for (const c of chunk) {
      const k = normalizeName(c.name);
      if (!clientsByNorm.has(k)) clientsByNorm.set(k, []);
      clientsByNorm.get(k).push(c);
    }
    if (chunk.length < PAGE) break;
    from += PAGE;
  }
  console.log(`[freshbooks-sync] loaded ${
    Array.from(clientsByNorm.values()).reduce((a, b) => a + b.length, 0)
  } clients (${clientsByNorm.size} unique names)`);

  // Compare and emit diffs.
  let matched = 0;
  let unmatched = 0;
  let multipleMatches = 0;
  let writes = 0;
  let conflicts = 0;
  let writtenRows = 0;
  const unmatchedList = [];
  const conflictList = [];

  for (const fb of byName.values()) {
    const key = normalizeName(fb.name);
    const candidates = clientsByNorm.get(key) || [];
    if (candidates.length === 0) {
      unmatched += 1;
      unmatchedList.push(fb.name);
      continue;
    }
    if (candidates.length > 1) multipleMatches += 1;
    matched += 1;
    const client = candidates[0];

    const changes = {};
    if (fb.email) {
      if (!client.email) {
        changes.email = { from: null, to: fb.email };
      } else if (client.email.toLowerCase() !== fb.email) {
        if (FORCE_EMAIL) {
          changes.email = { from: client.email, to: fb.email };
        } else {
          conflicts += 1;
          conflictList.push(
            `${fb.name}: email DB=${client.email} CSV=${fb.email}`,
          );
        }
      }
    }
    if (fb.phone) {
      if (!client.phone) {
        changes.phone = { from: null, to: fb.phone };
      } else if (client.phone.trim() !== fb.phone.trim()) {
        if (FORCE_PHONE) {
          changes.phone = { from: client.phone, to: fb.phone };
        } else {
          conflicts += 1;
          conflictList.push(
            `${fb.name}: phone DB=${client.phone} CSV=${fb.phone}`,
          );
        }
      }
    }

    const keys = Object.keys(changes);
    if (keys.length === 0) continue;

    console.log(`\n[${fb.name}]`);
    console.log(`  client: ${client.id}  (${client.name})`);
    if (candidates.length > 1) {
      console.log(
        `  ⚠ ${candidates.length} clients share this name — updating the first`,
      );
    }
    for (const k of keys) {
      console.log(`  ${k}: ${fmt(changes[k].from)} → ${fmt(changes[k].to)}`);
    }
    writes += keys.length;

    if (APPLY) {
      const payload = {};
      for (const k of keys) payload[k] = changes[k].to;
      const { error } = await supabase
        .from("clients")
        .update(payload)
        .eq("id", client.id);
      if (error) console.error(`  ✗ update failed: ${error.message}`);
      else writtenRows += 1;
    }
  }

  console.log("\n=== Summary ===");
  console.log(`CSV contacts (named):     ${byName.size}`);
  console.log(`Matched to a client:      ${matched}`);
  console.log(`Matched to multiple:      ${multipleMatches}`);
  console.log(`No DB match (skipped):    ${unmatched}`);
  console.log(`Conflicts (existing ≠ CSV): ${conflicts}`);
  console.log(`Field updates available:  ${writes}`);
  if (APPLY) console.log(`Rows actually updated:    ${writtenRows}`);
  else console.log("Mode: PREVIEW (no writes). Re-run with --apply to commit.");

  if (conflictList.length) {
    console.log("\nConflicts (use --force-email or --force-phone to overwrite):");
    for (const c of conflictList) console.log("  ⚠", c);
  }
  if (unmatchedList.length) {
    console.log(`\nUnmatched FreshBooks contacts (${unmatchedList.length}):`);
    for (const a of unmatchedList) console.log("  -", a);
  }
}

function fmt(v) {
  if (v == null) return "—";
  return String(v);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

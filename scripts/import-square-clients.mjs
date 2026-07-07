#!/usr/bin/env node
/**
 * Import (create + update) clients from a Square customer-directory CSV.
 *
 *   node scripts/import-square-clients.mjs <csv>              — dry run (needs DB)
 *   node scripts/import-square-clients.mjs <csv> --apply      — write to DB
 *   node scripts/import-square-clients.mjs <csv> --parse-only — just show
 *          the detected column mapping + parsed clients, no DB connection
 *
 * Getting the CSV out of Square:
 *   Square Dashboard → Customers → Directory → (top-right) Export →
 *   "Export all customers" → CSV. Save it locally and pass the path.
 *
 * Square's export column names drift between accounts/versions, so this
 * script detects columns by fuzzy header matching against a list of known
 * aliases (see COLUMN_ALIASES). The dry run prints exactly which CSV column
 * it mapped to each field — eyeball that before running --apply.
 *
 * Target: public.clients (name, email, phone, address, notes).
 *   display_name = "{First} {Last}" if either present, else Company Name,
 *                  else the local-part of Email. Rows with none are skipped.
 *   address      = "Street 1[, Street 2], City, State ZIP" (blanks dropped).
 *   notes        = Square "Memo" if present.
 *
 * Match strategy (first hit wins):
 *   1. existing clients.email == CSV email (case-insensitive)
 *   2. normalized clients.name == normalized display_name
 *
 * Updates only FILL EMPTY DB fields (never overwrites existing values):
 *   email, phone, address, notes.
 * Creates a new clients row for any CSV customer that didn't match.
 *
 * De-dupes CSV rows in-memory (by email, else normalized name) before any
 * DB work, merging missing contact fields across duplicates.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

// ---- args ---------------------------------------------------------

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const parseOnly = args.includes("--parse-only");
const csvPath = args.find((a) => !a.startsWith("--"));
if (!csvPath) {
  console.error(
    "Usage: node scripts/import-square-clients.mjs <csv-path> [--apply | --parse-only]",
  );
  process.exit(1);
}
if (!fs.existsSync(csvPath)) {
  console.error(`CSV not found: ${csvPath}`);
  process.exit(1);
}

// ---- env (only needed when we touch the DB) -----------------------

function readDotEnv() {
  const envPath = path.resolve(".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    if (!process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

function makeSupabase() {
  readDotEnv();
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local",
    );
    process.exit(1);
  }
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });
}

// ---- csv parser (RFC-4180-ish, handles quoted commas/newlines) -----

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
      } else cur += ch;
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
  // Drop trailing all-empty rows (Square exports often end with a blank line).
  while (out.length && out[out.length - 1].every((c) => c.trim() === "")) {
    out.pop();
  }
  return out;
}

// ---- header detection ---------------------------------------------

// Field -> ordered list of accepted header aliases (lowercased, exact match
// after trim). First matching header in the CSV wins.
const COLUMN_ALIASES = {
  first: ["first name", "given name", "first"],
  last: ["last name", "surname", "family name", "last"],
  company: ["company name", "company", "business name", "organization"],
  email: ["email address", "email", "e-mail", "email address 1"],
  phone: ["phone number", "phone", "phone number 1", "mobile", "mobile phone"],
  address1: [
    "street address 1",
    "address line 1",
    "street address",
    "address 1",
    "address",
  ],
  address2: ["street address 2", "address line 2", "address 2"],
  city: ["city"],
  state: ["state", "province/state", "province", "region"],
  zip: ["postal code", "zip", "zip code", "postcode"],
  memo: ["memo", "notes", "note", "customer note"],
};

function detectColumns(header) {
  const norm = header.map((h) => h.trim().toLowerCase());
  const idx = {};
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    idx[field] = -1;
    for (const alias of aliases) {
      const at = norm.indexOf(alias);
      if (at >= 0) {
        idx[field] = at;
        break;
      }
    }
  }
  return idx;
}

// ---- normalization ------------------------------------------------

function normName(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(llc|inc|realtor|realty|properties|group|team|design)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function cleanPhone(s) {
  if (!s) return null;
  // Square (like Excel) sometimes wraps phone values in a leading apostrophe
  // to stop them being read as numbers. Strip surrounding quotes/apostrophes.
  const v = String(s).trim().replace(/^['"]+|['"]+$/g, "");
  return v || null;
}
function cleanEmail(s) {
  if (!s) return null;
  const v = String(s).trim().toLowerCase();
  return v && v.includes("@") ? v : null;
}
function cleanText(s) {
  if (s == null) return null;
  const v = String(s).trim();
  return v || null;
}

function composeAddress(row, idx) {
  const get = (f) => (idx[f] >= 0 ? cleanText(row[idx[f]]) : null);
  const street = [get("address1"), get("address2")].filter(Boolean).join(" ");
  const cityStateZip = [
    get("city"),
    [get("state"), get("zip")].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(", ");
  const full = [street, cityStateZip].filter(Boolean).join(", ");
  return full || null;
}

// ---- build canonical client list from CSV -------------------------

function buildCsvClients(rows) {
  const header = rows[0];
  const idx = detectColumns(header);

  // A usable import needs at least one of first/last/company/email.
  if (idx.first < 0 && idx.last < 0 && idx.company < 0 && idx.email < 0) {
    console.error(
      "Could not find any name/company/email column. Detected headers:\n  " +
        header.map((h) => `"${h.trim()}"`).join(", "),
    );
    process.exit(1);
  }

  const clients = new Map();
  let skipped = 0;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.every((c) => c.trim() === "")) continue;
    const first = idx.first >= 0 ? cleanText(row[idx.first]) : null;
    const last = idx.last >= 0 ? cleanText(row[idx.last]) : null;
    const company = idx.company >= 0 ? cleanText(row[idx.company]) : null;
    const email = idx.email >= 0 ? cleanEmail(row[idx.email]) : null;
    const phone = idx.phone >= 0 ? cleanPhone(row[idx.phone]) : null;
    const address = composeAddress(row, idx);
    const notes = idx.memo >= 0 ? cleanText(row[idx.memo]) : null;

    let name = "";
    if (first || last) name = [first, last].filter(Boolean).join(" ");
    else if (company) name = company;
    else if (email) name = email.split("@")[0];
    else {
      skipped += 1;
      continue;
    }

    const key = email ?? `name:${normName(name)}`;
    const existing = clients.get(key);
    if (!existing) {
      clients.set(key, { name, email, phone, address, notes, sourceRow: r + 1 });
    } else {
      // Merge duplicates: keep first-seen name, fill any missing fields.
      if (!existing.email && email) existing.email = email;
      if (!existing.phone && phone) existing.phone = phone;
      if (!existing.address && address) existing.address = address;
      if (!existing.notes && notes) existing.notes = notes;
    }
  }
  return { clients, idx, header, skipped };
}

function printMapping(header, idx) {
  console.log("Detected column mapping:");
  for (const field of Object.keys(COLUMN_ALIASES)) {
    const col = idx[field];
    const label = col >= 0 ? `"${header[col].trim()}"` : "— (not found)";
    console.log(`  ${field.padEnd(9)} → ${label}`);
  }
  console.log();
}

// ---- main ---------------------------------------------------------

async function main() {
  const text = fs.readFileSync(csvPath, "utf8").replace(/^﻿/, "");
  const rows = parseCSV(text);
  if (rows.length < 2) {
    console.error("CSV has no data rows.");
    process.exit(1);
  }

  const { clients, idx, header, skipped } = buildCsvClients(rows);
  printMapping(header, idx);
  console.log(
    `Parsed ${clients.size} unique customers (skipped ${skipped} row(s) with no name/company/email).\n`,
  );

  if (parseOnly) {
    console.log("--- Parsed customers (first 25) ---");
    for (const c of [...clients.values()].slice(0, 25)) {
      const tail =
        [c.email, c.phone, c.address].filter(Boolean).join(" / ") ||
        "(no contact info)";
      console.log(`  ${c.name} — ${tail}`);
    }
    if (clients.size > 25) console.log(`  ... and ${clients.size - 25} more`);
    console.log("\nParse-only — no DB connection made.");
    return;
  }

  const supabase = makeSupabase();
  const { data: dbClients, error } = await supabase
    .from("clients")
    .select("id, name, email, phone, address, notes");
  if (error) {
    console.error("clients query failed:", error.message);
    process.exit(1);
  }
  const dbByEmail = new Map();
  const dbByNorm = new Map();
  for (const c of dbClients ?? []) {
    if (c.email) dbByEmail.set(c.email.toLowerCase(), c);
    dbByNorm.set(normName(c.name), c);
  }

  const updates = [];
  const creates = [];
  const noChange = [];
  for (const csv of clients.values()) {
    let match = csv.email ? dbByEmail.get(csv.email) : null;
    if (!match) match = dbByNorm.get(normName(csv.name));

    if (!match) {
      creates.push(csv);
      continue;
    }
    // Only ever fill blanks — never clobber a value already in the DB.
    const patch = {};
    if (!match.email && csv.email) patch.email = csv.email;
    if (!match.phone && csv.phone) patch.phone = csv.phone;
    if (!match.address && csv.address) patch.address = csv.address;
    if (!match.notes && csv.notes) patch.notes = csv.notes;
    if (Object.keys(patch).length > 0) {
      updates.push({ id: match.id, name: match.name, patch });
    } else {
      noChange.push(match.name);
    }
  }

  console.log(`Existing DB clients: ${dbClients?.length ?? 0}`);
  console.log(`Will UPDATE (fill blanks): ${updates.length}`);
  console.log(`Will CREATE: ${creates.length}`);
  console.log(`Already in sync: ${noChange.length}\n`);

  if (updates.length) {
    console.log("--- Updates (first 25) ---");
    for (const u of updates.slice(0, 25)) {
      const parts = Object.entries(u.patch).map(([k, v]) => `${k} +${v}`);
      console.log(`  ${u.name} → ${parts.join(", ")}`);
    }
    if (updates.length > 25) console.log(`  ... and ${updates.length - 25} more`);
    console.log();
  }
  if (creates.length) {
    console.log("--- New clients (first 25) ---");
    for (const c of creates.slice(0, 25)) {
      const tail =
        [c.email, c.phone].filter(Boolean).join(" / ") || "(no contact info)";
      console.log(`  ${c.name} — ${tail}`);
    }
    if (creates.length > 25) console.log(`  ... and ${creates.length - 25} more`);
    console.log();
  }

  if (!apply) {
    console.log("Dry run — re-run with --apply to write.");
    return;
  }

  let upOk = 0;
  let upFail = 0;
  for (const u of updates) {
    const { error } = await supabase
      .from("clients")
      .update(u.patch)
      .eq("id", u.id);
    if (error) {
      upFail += 1;
      console.error(`  UPDATE FAIL ${u.name}: ${error.message}`);
    } else upOk += 1;
  }
  console.log(`Updates: ${upOk} ok, ${upFail} failed`);

  if (creates.length) {
    const CHUNK = 100;
    let crOk = 0;
    let crFail = 0;
    for (let i = 0; i < creates.length; i += CHUNK) {
      const chunk = creates.slice(i, i + CHUNK).map((c) => ({
        name: c.name,
        email: c.email,
        phone: c.phone,
        address: c.address,
        notes: c.notes,
      }));
      const { error } = await supabase.from("clients").insert(chunk);
      if (error) {
        crFail += chunk.length;
        console.error(`  INSERT FAIL chunk ${i}: ${error.message}`);
      } else crOk += chunk.length;
    }
    console.log(`Creates: ${crOk} ok, ${crFail} failed`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

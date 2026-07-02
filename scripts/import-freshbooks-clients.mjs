#!/usr/bin/env node
/**
 * Import (create + update) clients from a FreshBooks CSV export.
 *
 *   node scripts/import-freshbooks-clients.mjs <csv>          — dry run
 *   node scripts/import-freshbooks-clients.mjs <csv> --apply  — write
 *
 * CSV columns (header row required):
 *   Organization, First Name, Last Name, Email, Phone,
 *   Address Line 1, Address Line 2, City, Province/State,
 *   Country, Postal Code, Notes
 *
 * Per-row identity:
 *   display_name = "{First} {Last}" if both present, else Organization,
 *                  else fall back to the local-part of Email.
 *   Rows with no name AND no Organization AND no Email are skipped.
 *
 * Match strategy (first hit wins):
 *   1. Existing clients.email == CSV email (case-insensitive).
 *   2. normalized clients.name == normalized display_name.
 *
 * Updates (only when DB column is empty and CSV has a value):
 *   - clients.email
 *   - clients.phone
 *   - (no address / notes updates — schema doesn't have those fields
 *     today and pulling them out of FreshBooks isn't a priority.)
 *
 * Creates:
 *   - A new clients row with { name, email, phone } for any CSV row
 *     that didn't match any existing client.
 *
 * Notes:
 *   - Phones get a light cleanup ("'+19161234567" -> "+19161234567",
 *     "(916) 123-4567" preserved). No format normalization beyond
 *     trimming the leading apostrophe FreshBooks adds to keep Excel
 *     from interpreting them as numbers.
 *   - Duplicate CSV rows are merged in-memory before any DB calls.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

// ---- env ----------------------------------------------------------

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
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY",
  );
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

// ---- args ---------------------------------------------------------

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const csvPath = args.find((a) => !a.startsWith("--"));
if (!csvPath) {
  console.error(
    "Usage: node scripts/import-freshbooks-clients.mjs <csv-path> [--apply]",
  );
  process.exit(1);
}

// ---- csv parser ---------------------------------------------------

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
  return out;
}

// ---- normalization ------------------------------------------------

function normName(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(llc|inc|realtor|realty|properties|group|team)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function cleanPhone(s) {
  if (!s) return null;
  // FreshBooks wraps phone values like `'+19161234567'` to keep Excel
  // from interpreting them as numbers. Strip both apostrophes + any
  // surrounding whitespace.
  let v = String(s).trim().replace(/^['"]+|['"]+$/g, "");
  return v || null;
}
function cleanEmail(s) {
  if (!s) return null;
  const v = String(s).trim().toLowerCase();
  return v || null;
}

// ---- main ---------------------------------------------------------

async function main() {
  const text = fs.readFileSync(csvPath, "utf8");
  const rows = parseCSV(text);
  if (rows.length < 2) {
    console.error("CSV is empty");
    process.exit(1);
  }
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = {
    org: header.indexOf("organization"),
    first: header.indexOf("first name"),
    last: header.indexOf("last name"),
    email: header.indexOf("email"),
    phone: header.indexOf("phone"),
  };
  if (Object.values(idx).some((i) => i < 0)) {
    console.error("CSV missing required columns. Got:", header);
    process.exit(1);
  }

  // Build a canonical list of CSV clients, de-duped by best identity.
  // Shape: { name, email, phone, sourceRow }
  const csvClients = new Map();
  let blank = 0;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const org = (row[idx.org] || "").trim();
    const first = (row[idx.first] || "").trim();
    const last = (row[idx.last] || "").trim();
    const email = cleanEmail(row[idx.email]);
    const phone = cleanPhone(row[idx.phone]);
    let name = "";
    if (first || last) name = `${first} ${last}`.trim();
    else if (org) name = org;
    else if (email) {
      // Skip secondary-email rows that have no name AND no org —
      // they almost always duplicate a primary row above and we
      // can't reliably tie them back.
      blank += 1;
      continue;
    } else {
      blank += 1;
      continue;
    }
    // Dedup key: email if present, else normalized name.
    const key = email ?? `name:${normName(name)}`;
    const existing = csvClients.get(key);
    if (!existing) {
      csvClients.set(key, { name, email, phone, sourceRow: r + 1 });
    } else {
      // Merge — keep first-seen name, fill in missing email/phone.
      if (!existing.email && email) existing.email = email;
      if (!existing.phone && phone) existing.phone = phone;
    }
  }

  // Pull existing clients.
  const { data: dbClients, error } = await supabase
    .from("clients")
    .select("id, name, email, phone");
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

  // Plan
  const updates = []; // [{id, before, after, csv}]
  const creates = []; // [{ name, email, phone, csvRow }]
  const noChange = [];
  for (const csv of csvClients.values()) {
    let match = csv.email ? dbByEmail.get(csv.email) : null;
    if (!match) match = dbByNorm.get(normName(csv.name));

    if (!match) {
      creates.push(csv);
      continue;
    }
    const after = { email: match.email, phone: match.phone };
    let changed = false;
    if (!match.email && csv.email) {
      after.email = csv.email;
      changed = true;
    }
    if (!match.phone && csv.phone) {
      after.phone = csv.phone;
      changed = true;
    }
    if (changed) {
      updates.push({
        id: match.id,
        before: { email: match.email, phone: match.phone },
        after,
        csv,
        name: match.name,
      });
    } else {
      noChange.push(match.name);
    }
  }

  // ---- report ----
  console.log(`\nCSV rows considered: ${csvClients.size} (skipped ${blank} blank/email-only rows)`);
  console.log(`Existing DB clients: ${dbClients?.length ?? 0}`);
  console.log(`Will UPDATE: ${updates.length}`);
  console.log(`Will CREATE: ${creates.length}`);
  console.log(`Already in sync: ${noChange.length}`);
  console.log();

  if (updates.length > 0) {
    console.log("--- Updates (first 25) ---");
    for (const u of updates.slice(0, 25)) {
      const parts = [];
      if (u.before.email !== u.after.email)
        parts.push(`email +${u.after.email}`);
      if (u.before.phone !== u.after.phone)
        parts.push(`phone +${u.after.phone}`);
      console.log(`  ${u.name} → ${parts.join(", ")}`);
    }
    if (updates.length > 25)
      console.log(`  ... and ${updates.length - 25} more`);
    console.log();
  }
  if (creates.length > 0) {
    console.log("--- New clients (first 25) ---");
    for (const c of creates.slice(0, 25)) {
      const tail = [c.email, c.phone].filter(Boolean).join(" / ") || "(no contact info)";
      console.log(`  ${c.name} — ${tail}`);
    }
    if (creates.length > 25)
      console.log(`  ... and ${creates.length - 25} more`);
    console.log();
  }

  if (!apply) {
    console.log("Dry run — re-run with --apply to write.");
    return;
  }

  // ---- apply ----
  let upOk = 0;
  let upFail = 0;
  for (const u of updates) {
    const patch = {};
    if (u.before.email !== u.after.email) patch.email = u.after.email;
    if (u.before.phone !== u.after.phone) patch.phone = u.after.phone;
    const { error } = await supabase
      .from("clients")
      .update(patch)
      .eq("id", u.id);
    if (error) {
      upFail += 1;
      console.error(`  UPDATE FAIL ${u.name}: ${error.message}`);
    } else upOk += 1;
  }
  console.log(`Updates: ${upOk} ok, ${upFail} failed`);

  if (creates.length > 0) {
    // Insert in chunks to keep things sane.
    const CHUNK = 100;
    let crOk = 0;
    let crFail = 0;
    for (let i = 0; i < creates.length; i += CHUNK) {
      const chunk = creates.slice(i, i + CHUNK).map((c) => ({
        name: c.name,
        email: c.email,
        phone: c.phone,
      }));
      const { error } = await supabase.from("clients").insert(chunk);
      if (error) {
        crFail += chunk.length;
        console.error(`  INSERT FAIL chunk ${i}: ${error.message}`);
      } else {
        crOk += chunk.length;
      }
    }
    console.log(`Creates: ${crOk} ok, ${crFail} failed`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

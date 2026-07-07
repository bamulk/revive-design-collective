#!/usr/bin/env node
/**
 * Import Square invoices as projects (stages) + payment-ledger entries.
 *
 *   node scripts/import-square-invoices.mjs <csv>              — dry run (needs DB)
 *   node scripts/import-square-invoices.mjs <csv> --apply      — write to DB
 *   node scripts/import-square-invoices.mjs <csv> --parse-only — parse + map only,
 *          no DB connection
 *
 * Requires migration 036_stage_square_invoice.sql to be applied first
 * (adds stages.square_invoice_number, used for idempotent re-runs).
 *
 * Getting the CSV out of Square:
 *   Square Dashboard → Invoices → (top-right) Export → CSV.
 *
 * Scope: only "real" invoices are imported —
 *   Paid, Overdue, Unpaid, Payment Pending.
 * Canceled / Draft / Failed are skipped (voided or unfinished, not jobs).
 *
 * Mapping (Square invoice → public.stages):
 *   address              = Invoice Title (the only address-bearing field;
 *                          Square titles read like "857 and 851 38th Staging")
 *   amount               = Requested Amount
 *   stage_date           = Service date if present, else Invoice Date
 *   status               = 'completed' (these are historical invoices)
 *   square_invoice_number = Invoice ID (e.g. "#000408") — dedup key
 *   notes                = "Square invoice #000408 — <Status>"
 *
 * Payments (public.stage_payments) — created when Amount Paid > 0:
 *   amount  = Amount Paid
 *   paid_at = Last Payment Date (fallback: Invoice Date)
 *   method  = 'card'
 *   note    = "Square #000408"
 *   A DB trigger rolls these up into stages.paid_at automatically.
 *
 * Client linkage: match existing clients by email (case-insensitive) then
 * by normalized name; create a new client (name / email / phone) when none
 * matches, so this script works whether or not the customer import ran.
 *
 * Idempotent: invoices whose number already exists on a stage are skipped,
 * so re-running only loads new invoices.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const KEEP_STATUSES = new Set([
  "paid",
  "overdue",
  "unpaid",
  "payment pending",
]);

// ---- args ---------------------------------------------------------

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const parseOnly = args.includes("--parse-only");
const csvPath = args.find((a) => !a.startsWith("--"));
if (!csvPath) {
  console.error(
    "Usage: node scripts/import-square-invoices.mjs <csv-path> [--apply | --parse-only]",
  );
  process.exit(1);
}
if (!fs.existsSync(csvPath)) {
  console.error(`CSV not found: ${csvPath}`);
  process.exit(1);
}

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
        } else inQuotes = false;
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
  while (out.length && out[out.length - 1].every((c) => c.trim() === "")) {
    out.pop();
  }
  return out;
}

// ---- helpers ------------------------------------------------------

function normName(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(llc|inc|realtor|realty|properties|group|team|design)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
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
function cleanPhone(s) {
  if (!s) return null;
  const v = String(s).trim().replace(/^['"]+|['"]+$/g, "");
  return v || null;
}
function money(s) {
  if (s == null) return 0;
  const v = String(s).replace(/[$,]/g, "").trim();
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}
function isoDate(s) {
  const v = cleanText(s);
  if (!v) return null;
  // Square exports dates as YYYY-MM-DD already; guard anyway.
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function detectColumns(header) {
  const norm = header.map((h) => h.trim().toLowerCase());
  const want = {
    invoiceId: ["invoice id"],
    invoiceDate: ["invoice date"],
    serviceDate: ["service date"],
    customerName: ["customer name"],
    customerEmail: ["customer email"],
    customerPhone: ["customer phone"],
    title: ["invoice title"],
    status: ["status"],
    requested: ["requested amount"],
    amountPaid: ["amount paid"],
    lastPayment: ["last payment date"],
  };
  const idx = {};
  for (const [field, aliases] of Object.entries(want)) {
    idx[field] = -1;
    for (const a of aliases) {
      const at = norm.indexOf(a);
      if (at >= 0) {
        idx[field] = at;
        break;
      }
    }
  }
  return idx;
}

// ---- build invoice records ----------------------------------------

function buildInvoices(rows) {
  const header = rows[0];
  const idx = detectColumns(header);
  const required = ["invoiceId", "customerName", "status", "requested", "title"];
  const missing = required.filter((f) => idx[f] < 0);
  if (missing.length) {
    console.error(
      "CSV missing required columns: " +
        missing.join(", ") +
        "\nDetected headers:\n  " +
        header.map((h) => `"${h.trim()}"`).join(", "),
    );
    process.exit(1);
  }

  const kept = [];
  const skippedByStatus = {};
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.every((c) => c.trim() === "")) continue;
    const get = (f) => (idx[f] >= 0 ? row[idx[f]] : "");
    const status = (cleanText(get("status")) || "").toLowerCase();
    if (!KEEP_STATUSES.has(status)) {
      const label = cleanText(get("status")) || "(blank)";
      skippedByStatus[label] = (skippedByStatus[label] || 0) + 1;
      continue;
    }
    const invoiceNumber = cleanText(get("invoiceId"));
    if (!invoiceNumber) continue;
    const name = cleanText(get("customerName")) || "(no name)";
    const email = cleanEmail(get("customerEmail"));
    const phone = cleanPhone(get("customerPhone"));
    const title = cleanText(get("title")) || `Square invoice ${invoiceNumber}`;
    const amount = money(get("requested"));
    const amountPaid = money(get("amountPaid"));
    const invDate = isoDate(get("invoiceDate"));
    const svcDate = isoDate(get("serviceDate"));
    const lastPay = isoDate(get("lastPayment"));
    const statusLabel = cleanText(get("status"));

    kept.push({
      invoiceNumber,
      clientName: name,
      clientEmail: email,
      clientPhone: phone,
      address: title,
      amount,
      amountPaid,
      stageDate: svcDate || invDate,
      paidDate: lastPay || invDate,
      notes: `Square invoice ${invoiceNumber} — ${statusLabel}`,
    });
  }
  return { kept, skippedByStatus, idx, header };
}

// ---- main ---------------------------------------------------------

async function main() {
  const text = fs.readFileSync(csvPath, "utf8").replace(/^﻿/, "");
  const rows = parseCSV(text);
  if (rows.length < 2) {
    console.error("CSV has no data rows.");
    process.exit(1);
  }

  const { kept, skippedByStatus } = buildInvoices(rows);
  const revenue = kept.reduce((s, k) => s + k.amount, 0);
  const collected = kept.reduce((s, k) => s + k.amountPaid, 0);
  const withPayment = kept.filter((k) => k.amountPaid > 0).length;

  console.log(`\nInvoices kept (Paid/Overdue/Unpaid/Payment Pending): ${kept.length}`);
  const skipTotal = Object.values(skippedByStatus).reduce((a, b) => a + b, 0);
  console.log(
    `Skipped ${skipTotal}: ` +
      (Object.entries(skippedByStatus)
        .map(([k, v]) => `${k} ${v}`)
        .join(", ") || "none"),
  );
  console.log(`Requested total: $${revenue.toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
  console.log(`Collected total: $${collected.toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
  console.log(`Payment-ledger entries to create: ${withPayment}\n`);

  if (parseOnly) {
    console.log("--- Sample (first 20) ---");
    for (const k of kept.slice(0, 20)) {
      console.log(
        `  ${k.invoiceNumber}  ${k.stageDate || "no-date"}  $${k.amount
          .toFixed(2)
          .padStart(9)}  paid $${k.amountPaid.toFixed(2).padStart(9)}  ${(
          k.clientName || ""
        ).slice(0, 20).padEnd(20)}  ${k.address.slice(0, 40)}`,
      );
    }
    if (kept.length > 20) console.log(`  ... and ${kept.length - 20} more`);
    console.log("\nParse-only — no DB connection made.");
    return;
  }

  const supabase = makeSupabase();

  // Existing state.
  const { data: dbClients, error: cErr } = await supabase
    .from("clients")
    .select("id, name, email");
  if (cErr) {
    console.error("clients query failed:", cErr.message);
    process.exit(1);
  }
  const byEmail = new Map();
  const byNorm = new Map();
  for (const c of dbClients ?? []) {
    if (c.email) byEmail.set(c.email.toLowerCase(), c.id);
    if (!byNorm.has(normName(c.name))) byNorm.set(normName(c.name), c.id);
  }

  const { data: dbStages, error: sErr } = await supabase
    .from("stages")
    .select("square_invoice_number")
    .not("square_invoice_number", "is", null);
  if (sErr) {
    console.error(
      "stages query failed (did you run migration 036?): " + sErr.message,
    );
    process.exit(1);
  }
  const alreadyImported = new Set(
    (dbStages ?? []).map((s) => s.square_invoice_number),
  );

  // Split into new vs already-imported.
  const toImport = kept.filter((k) => !alreadyImported.has(k.invoiceNumber));
  const skipDupes = kept.length - toImport.length;

  // Which clients need creating? Key by email else normalized name.
  const resolveKey = (k) =>
    k.clientEmail ? `e:${k.clientEmail}` : `n:${normName(k.clientName)}`;
  const existingIdFor = (k) =>
    (k.clientEmail && byEmail.get(k.clientEmail)) ||
    byNorm.get(normName(k.clientName)) ||
    null;

  const newClientByKey = new Map();
  for (const k of toImport) {
    if (existingIdFor(k)) continue;
    const key = resolveKey(k);
    if (!newClientByKey.has(key)) {
      newClientByKey.set(key, {
        name: k.clientName,
        email: k.clientEmail,
        phone: k.clientPhone,
      });
    }
  }

  console.log(`New invoices to import: ${toImport.length}`);
  console.log(`Already imported (skipped): ${skipDupes}`);
  console.log(`New clients to create: ${newClientByKey.size}`);
  console.log(`Existing clients matched: ${toImport.length - newClientByKey.size >= 0 ? "" : ""}`);
  console.log();

  if (!apply) {
    console.log("--- New projects (first 20) ---");
    for (const k of toImport.slice(0, 20)) {
      const link = existingIdFor(k) ? "existing client" : "NEW client";
      console.log(
        `  ${k.invoiceNumber}  $${k.amount.toFixed(2).padStart(9)}  ${k.clientName.slice(0, 20).padEnd(20)}  ${link}  ${k.address.slice(0, 32)}`,
      );
    }
    if (toImport.length > 20) console.log(`  ... and ${toImport.length - 20} more`);
    console.log("\nDry run — re-run with --apply to write.");
    return;
  }

  // ---- apply ----

  // 1) Create missing clients (chunked), then fold their ids into the maps.
  const newClients = [...newClientByKey.values()];
  let clientsCreated = 0;
  const CHUNK = 100;
  for (let i = 0; i < newClients.length; i += CHUNK) {
    const chunk = newClients.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("clients")
      .insert(chunk)
      .select("id, name, email");
    if (error) {
      console.error(`  CLIENT INSERT FAIL chunk ${i}: ${error.message}`);
      process.exit(1);
    }
    for (const c of data ?? []) {
      if (c.email) byEmail.set(c.email.toLowerCase(), c.id);
      if (!byNorm.has(normName(c.name))) byNorm.set(normName(c.name), c.id);
    }
    clientsCreated += data?.length ?? 0;
  }
  console.log(`Clients created: ${clientsCreated}`);

  // 2) Insert stages (chunked, returning ids keyed by invoice number).
  const stageRows = toImport.map((k) => ({
    client_id: existingIdFor(k),
    address: k.address,
    amount: k.amount,
    status: "completed",
    stage_date: k.stageDate,
    notes: k.notes,
    square_invoice_number: k.invoiceNumber,
  }));
  // Every stage should now resolve a client_id.
  const orphan = stageRows.find((s) => !s.client_id);
  if (orphan) {
    console.error(
      `Internal error: no client_id resolved for invoice ${orphan.square_invoice_number}`,
    );
    process.exit(1);
  }

  const stageIdByInvoice = new Map();
  let stagesCreated = 0;
  for (let i = 0; i < stageRows.length; i += CHUNK) {
    const chunk = stageRows.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("stages")
      .insert(chunk)
      .select("id, square_invoice_number");
    if (error) {
      console.error(`  STAGE INSERT FAIL chunk ${i}: ${error.message}`);
      process.exit(1);
    }
    for (const s of data ?? []) stageIdByInvoice.set(s.square_invoice_number, s.id);
    stagesCreated += data?.length ?? 0;
  }
  console.log(`Projects (stages) created: ${stagesCreated}`);

  // 3) Insert payment-ledger rows for paid invoices.
  const payments = [];
  for (const k of toImport) {
    if (k.amountPaid > 0) {
      const stageId = stageIdByInvoice.get(k.invoiceNumber);
      if (!stageId) continue;
      payments.push({
        stage_id: stageId,
        amount: k.amountPaid,
        paid_at: k.paidDate || k.stageDate,
        method: "card",
        note: `Square ${k.invoiceNumber}`,
      });
    }
  }
  let paymentsCreated = 0;
  for (let i = 0; i < payments.length; i += CHUNK) {
    const chunk = payments.slice(i, i + CHUNK);
    const { error } = await supabase.from("stage_payments").insert(chunk);
    if (error) {
      console.error(`  PAYMENT INSERT FAIL chunk ${i}: ${error.message}`);
    } else paymentsCreated += chunk.length;
  }
  console.log(`Payment-ledger rows created: ${paymentsCreated}`);
  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

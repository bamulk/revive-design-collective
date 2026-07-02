#!/usr/bin/env node
/**
 * Resolve zillow_url for stages that don't have one yet.
 *
 *   node scripts/backfill-zillow-urls.mjs                — dry run
 *   node scripts/backfill-zillow-urls.mjs --apply        — write
 *   node scripts/backfill-zillow-urls.mjs --apply --all  — also backfill
 *                                                          non-staged rows
 *
 * Uses Zillow's free public autocomplete (no API key, no cost) to
 * resolve each address to a zpid + canonical /homedetails/ URL, then
 * writes it to stages.zillow_url. Designed for the daily listing-
 * status cron to start picking up the row.
 *
 * Defaults to status='staged' since that's what the listing monitor
 * watches. Pass --all to backfill every stage missing a URL.
 *
 * Throttled to ~1 req/sec to stay polite to Zillow's CDN. 65 rows
 * takes roughly 1 minute.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

// ---- env ---------------------------------------------------------

function readDotEnv() {
  const p = path.resolve(".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
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

// ---- args --------------------------------------------------------

const apply = process.argv.includes("--apply");
const all = process.argv.includes("--all");

// ---- zillow autocomplete ----------------------------------------

async function resolveZpid(address, city) {
  const state = "CA";
  const query = [address, city, state].filter(Boolean).join(" ");
  const url = new URL(
    "https://www.zillowstatic.com/autocomplete/v3/suggestions",
  );
  url.searchParams.set("q", query);
  url.searchParams.set("resultTypes", "allAddress");
  try {
    const res = await fetch(url.toString(), {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const results = json?.results ?? [];
    for (const r of results) {
      const meta = r?.metaData;
      if (!meta?.zpid) continue;
      if (state && meta.state?.toUpperCase() !== state.toUpperCase())
        continue;
      const z =
        `https://www.zillow.com/homedetails/` +
        `${meta.streetNumber}-${meta.streetName?.replace(/\s+/g, "-")}-` +
        `${meta.city?.replace(/\s+/g, "-")}-${meta.state}-${meta.zipCode}/` +
        `${meta.zpid}_zpid/`;
      return { zpid: meta.zpid, url: z };
    }
    return null;
  } catch (e) {
    return null;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---- main --------------------------------------------------------

async function main() {
  let q = supabase
    .from("stages")
    .select("id, address, city, status")
    .is("zillow_url", null);
  if (!all) q = q.eq("status", "staged");
  const { data: rows, error } = await q;
  if (error) {
    console.error(error.message);
    process.exit(1);
  }
  console.log(
    `Found ${rows.length} stages missing zillow_url${all ? "" : " (status='staged')"}`,
  );

  let ok = 0;
  let miss = 0;
  let writeFail = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const resolved = await resolveZpid(r.address ?? "", r.city ?? "");
    const tag = `[${i + 1}/${rows.length}]`;
    if (!resolved) {
      miss += 1;
      console.log(`${tag} miss — ${r.address}${r.city ? ", " + r.city : ""}`);
    } else {
      ok += 1;
      console.log(`${tag} ok   — ${r.address}: ${resolved.url}`);
      if (apply) {
        const { error: upErr } = await supabase
          .from("stages")
          .update({ zillow_url: resolved.url })
          .eq("id", r.id);
        if (upErr) {
          writeFail += 1;
          console.error(`  WRITE FAIL: ${upErr.message}`);
        }
      }
    }
    // ~1 req/sec to be polite.
    await sleep(900);
  }

  console.log();
  console.log(`Resolved: ${ok}`);
  console.log(`Missed:   ${miss}`);
  if (apply) console.log(`Write fails: ${writeFail}`);
  else console.log("Dry run — re-run with --apply to write.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

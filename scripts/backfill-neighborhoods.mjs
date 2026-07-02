#!/usr/bin/env node
/**
 * Reverse-geocode stages.neighborhood from cached lat/lng.
 *
 *   node scripts/backfill-neighborhoods.mjs            — dry run
 *   node scripts/backfill-neighborhoods.mjs --apply    — write
 *   node scripts/backfill-neighborhoods.mjs --apply --staged-only
 *
 * Uses Nominatim's free reverse endpoint (suburb / neighbourhood /
 * quarter / city_district). Throttled ~1.1 req/sec to respect the
 * public usage policy. Only touches rows that have lat+lng AND no
 * neighborhood yet.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

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
  console.error("Missing Supabase env vars");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

const apply = process.argv.includes("--apply");
const stagedOnly = process.argv.includes("--staged-only");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function reverseGeocode(lat, lng) {
  const url =
    `https://nominatim.openstreetmap.org/reverse?format=json` +
    `&lat=${lat}&lon=${lng}&zoom=16&addressdetails=1`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "revive-design-collective-app/1.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { neighborhood: null, city: null };
    const d = await res.json();
    const a = d.address ?? {};
    return {
      neighborhood:
        a.suburb || a.neighbourhood || a.quarter || a.city_district || null,
      city: a.city || a.town || a.village || a.hamlet || null,
    };
  } catch {
    return { neighborhood: null, city: null };
  }
}

async function main() {
  let q = supabase
    .from("stages")
    .select("id, address, city, lat, lng")
    .not("lat", "is", null)
    .not("lng", "is", null)
    .is("neighborhood", null);
  if (stagedOnly) q = q.eq("status", "staged");
  const { data: rows, error } = await q;
  if (error) {
    console.error(error.message);
    process.exit(1);
  }
  console.log(`Found ${rows.length} stages with coords and no neighborhood`);

  let ok = 0;
  let miss = 0;
  let skipped = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const { neighborhood, city } = await reverseGeocode(
      Number(r.lat),
      Number(r.lng),
    );
    const tag = `[${i + 1}/${rows.length}]`;
    // Guard: only store when the reverse-geocoded city matches the
    // stage's city — protects against city-less stages whose cached
    // coords landed in the wrong metro.
    const cityMatches =
      !!r.city &&
      !!city &&
      r.city.trim().toLowerCase() === city.trim().toLowerCase();
    if (!neighborhood) {
      miss += 1;
      console.log(`${tag} —      ${r.address}`);
    } else if (!cityMatches) {
      skipped += 1;
      console.log(
        `${tag} SKIP (${neighborhood} in ${city ?? "?"} ≠ ${r.city ?? "no city"})  ${r.address}`,
      );
    } else {
      ok += 1;
      console.log(`${tag} ${neighborhood}  ←  ${r.address}`);
      if (apply) {
        await supabase
          .from("stages")
          .update({ neighborhood })
          .eq("id", r.id);
      }
    }
    await sleep(1100);
  }

  console.log(
    `\nResolved: ${ok}  ·  No area: ${miss}  ·  Skipped (city mismatch): ${skipped}`,
  );
  if (!apply) console.log("Dry run — re-run with --apply to write.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

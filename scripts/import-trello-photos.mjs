#!/usr/bin/env node
/**
 * Backfill stage_photos from Trello card attachments.
 *
 *   node scripts/import-trello-photos.mjs                   — all in-scope stages
 *   node scripts/import-trello-photos.mjs --upcoming-only   — only status='scheduled'
 *
 * Use --upcoming-only when you need the photos for jobs you're about
 * to do (the much smaller set finishes in a few minutes instead of an hour).
 *
 * For every stage with a trello_card_id, this script:
 *   1. Lists the card's attachments via Trello's REST API
 *   2. Filters to image uploads we haven't imported yet (idempotency
 *      via stage_photos.trello_attachment_id UNIQUE index)
 *   3. Downloads each attachment using the OAuth Authorization header
 *   4. Compresses with sharp (1920px max, JPEG q=82) — same target
 *      our iPhone upload pipeline produces
 *   5. Uploads to Supabase Storage (stage-photos bucket)
 *   6. Inserts a stage_photos row stamped with the Trello attachment id
 *
 * Throttled to stay under Trello's 100 req / 10s token limit.
 *
 * Reads creds from .env.local: TRELLO_API_KEY, TRELLO_TOKEN,
 * NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import heicConvert from "heic-convert";

// ---- env loading -----------------------------------------------------------
const env = Object.fromEntries(
  fs
    .readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const TRELLO_KEY = env.TRELLO_API_KEY;
const TRELLO_TOKEN = env.TRELLO_TOKEN;
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!TRELLO_KEY || !TRELLO_TOKEN) {
  console.error("Missing TRELLO_API_KEY or TRELLO_TOKEN in .env.local");
  process.exit(1);
}
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing Supabase credentials in .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ---- Trello helpers --------------------------------------------------------
const TRELLO_AUTH = `OAuth oauth_consumer_key="${TRELLO_KEY}", oauth_token="${TRELLO_TOKEN}"`;

/** Throttle: stay under 100 token requests / 10 seconds → ~9/sec safe. */
async function throttle() {
  await new Promise((r) => setTimeout(r, 120));
}

async function fetchAttachments(cardId) {
  const url = `https://api.trello.com/1/cards/${cardId}/attachments?key=${TRELLO_KEY}&token=${TRELLO_TOKEN}&fields=id,name,url,mimeType,isUpload,bytes,date`;
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 404) return [];
    throw new Error(`Trello /attachments ${res.status} for card ${cardId}`);
  }
  return await res.json();
}

async function downloadAttachment(url) {
  const res = await fetch(url, { headers: { Authorization: TRELLO_AUTH } });
  if (!res.ok) {
    throw new Error(`download ${res.status}: ${url.slice(0, 80)}…`);
  }
  return Buffer.from(await res.arrayBuffer());
}

// ---- Image processing ------------------------------------------------------

/**
 * Sniff a magic-number prefix to decide if this is a HEIC file. Sharp's
 * built-in macOS binary doesn't ship with HEIC support, so we convert
 * those buffers to JPEG via heic-convert (pure JS) before handing off
 * to sharp for the resize/compress.
 */
function isHeic(buf, mimeType, url) {
  if (mimeType?.toLowerCase().includes("heic")) return true;
  if (mimeType?.toLowerCase().includes("heif")) return true;
  if (/\.hei[fc](\?|$)/i.test(url || "")) return true;
  // Magic check: bytes 4..12 of a HEIF/HEIC file are 'ftypheic' or similar.
  const head = buf.subarray(4, 12).toString("ascii");
  return /^ftyp(heic|heix|hevc|hevx|mif1|msf1|heim|heis|hevm|hevs)/.test(head);
}

async function decodeHeic(buf) {
  // heic-convert returns an ArrayBuffer of JPEG bytes.
  const ab = await heicConvert({
    buffer: buf,
    format: "JPEG",
    quality: 0.9,
  });
  return Buffer.from(ab);
}

async function compress(buf, opts = {}) {
  // Same target as src/lib/image-compress.ts: max 1920px on the long
  // edge, JPEG quality 82. Sharp also auto-rotates per EXIF.
  // For HEIC input, decode to JPEG first since macOS sharp lacks the
  // HEIC plugin.
  let working = buf;
  if (isHeic(buf, opts.mimeType, opts.url)) {
    working = await decodeHeic(buf);
  }
  return await sharp(working)
    .rotate()
    .resize({
      width: 1920,
      height: 1920,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
}

// ---- Main ------------------------------------------------------------------
async function main() {
  // Cutoff: January 1 of the current calendar year. We skip stages
  // whose stage_date is older than this AND skip individual attachments
  // uploaded before this. Two filters: the stage-level one avoids
  // hundreds of unnecessary API calls for old completed jobs; the
  // attachment-level one catches the edge case of an old stage with
  // newly added photos.
  const year = new Date().getFullYear();
  const cutoffDate = `${year}-01-01`;
  const cutoffISO = `${cutoffDate}T00:00:00.000Z`;
  const upcomingOnly = process.argv.includes("--upcoming-only");
  const noCutoff = process.argv.includes("--no-cutoff");
  // --stage <uuid> backfills photos for a single stage, bypassing the
  // year cutoff (combined with --no-cutoff for the per-attachment
  // filter). Handy when an older card just lost its photos or had new
  // attachments added after the initial import.
  const stageFlagIdx = process.argv.indexOf("--stage");
  const onlyStageId =
    stageFlagIdx >= 0 ? process.argv[stageFlagIdx + 1] : null;
  if (onlyStageId) {
    console.log(`[trello-photos] --stage: targeting single stage ${onlyStageId}`);
  }
  if (noCutoff) {
    console.log("[trello-photos] --no-cutoff: ignoring upload date cutoff");
  } else {
    console.log(`[trello-photos] cutoff: ${cutoffDate} (uploads before this are skipped)`);
  }
  if (upcomingOnly) {
    console.log("[trello-photos] --upcoming-only: filtering to status='scheduled' stages");
  }

  // Pull stages with a Trello card AND a stage_date within the last
  // year (or no stage_date — better to scan those than risk losing
  // recent jobs that just lack the field). Saves a huge amount of
  // API time vs. scanning all 770+ historical cards.
  let query = supabase
    .from("stages")
    .select("id, address, stage_date, trello_card_id")
    .not("trello_card_id", "is", null);
  if (onlyStageId) {
    query = query.eq("id", onlyStageId);
  } else if (!noCutoff) {
    query = query.or(`stage_date.gte.${cutoffDate},stage_date.is.null`);
  }
  if (upcomingOnly) {
    query = query.eq("status", "scheduled");
  }
  // Soonest-upcoming first so the most actionable photos land first
  // (matters if the user interrupts the run partway through).
  query = query.order("stage_date", { ascending: true, nullsFirst: false });

  const { data: stages, error } = await query;

  if (error) throw error;
  console.log(
    `[trello-photos] ${stages.length} stages with stage_date >= ${cutoffDate}${upcomingOnly ? " AND status='scheduled'" : " (or null)"}`,
  );

  // Build a set of attachment IDs we've already imported so we can skip
  // cheaply without UNIQUE-violation round-trips. Supabase caps queries
  // at 1000 rows by default, so we have to paginate explicitly — without
  // this, the import re-attempts every photo past the 1000th and then
  // erroneously counts the rejection as a 'skip'.
  const alreadyImported = new Set();
  {
    let off = 0;
    const PAGE = 1000;
    while (true) {
      const { data: chunk, error } = await supabase
        .from("stage_photos")
        .select("trello_attachment_id")
        .not("trello_attachment_id", "is", null)
        .range(off, off + PAGE - 1);
      if (error) throw error;
      for (const r of chunk) alreadyImported.add(r.trello_attachment_id);
      if (chunk.length < PAGE) break;
      off += PAGE;
    }
  }
  console.log(
    `[trello-photos] ${alreadyImported.size} photos already imported — skipping those`,
  );

  let inspected = 0;
  let uploaded = 0;
  let skipped = 0;
  let skippedByAge = 0;
  let failed = 0;

  for (const stage of stages) {
    inspected += 1;
    let attachments;
    try {
      attachments = await fetchAttachments(stage.trello_card_id);
    } catch (e) {
      console.error(`  ✗ list ${stage.address}: ${e.message}`);
      failed += 1;
      await throttle();
      continue;
    }
    await throttle();

    // Filter to uploaded image attachments we haven't ingested yet AND
    // that were uploaded within the last year. Older attachments are
    // counted separately so the summary tells you how many we left behind.
    const beforeAgeFilter = attachments.filter(
      (a) =>
        a.isUpload &&
        a.url &&
        !alreadyImported.has(a.id) &&
        (a.mimeType?.startsWith("image/") ||
          /\.(jpe?g|png|heic|webp|gif)(\?|$)/i.test(a.url)),
    );
    const candidates = noCutoff
      ? beforeAgeFilter
      : beforeAgeFilter.filter((a) => !a.date || a.date >= cutoffISO);
    skippedByAge += beforeAgeFilter.length - candidates.length;

    if (candidates.length === 0) continue;

    console.log(
      `[${inspected}/${stages.length}] ${stage.address} — ${candidates.length} new photo(s)`,
    );

    for (const att of candidates) {
      try {
        const raw = await downloadAttachment(att.url);
        const jpeg = await compress(raw, {
          mimeType: att.mimeType,
          url: att.url,
        });
        const storagePath = `${stage.id}/trello-${att.id}.jpg`;
        const up = await supabase.storage
          .from("stage-photos")
          .upload(storagePath, jpeg, {
            contentType: "image/jpeg",
            upsert: true,
          });
        if (up.error) throw up.error;

        const ins = await supabase.from("stage_photos").insert({
          stage_id: stage.id,
          storage_path: storagePath,
          trello_attachment_id: att.id,
        });
        if (ins.error) {
          // Unique violation = race or duplicate. Skip quietly.
          if (ins.error.code === "23505") {
            skipped += 1;
            continue;
          }
          throw ins.error;
        }
        uploaded += 1;
        alreadyImported.add(att.id);
      } catch (e) {
        failed += 1;
        console.error(`  ✗ ${att.name || att.id}: ${e.message}`);
      }
      await throttle();
    }
  }

  console.log("");
  console.log(`[trello-photos] Done.`);
  console.log(`  Stages inspected:  ${inspected}`);
  console.log(`  Photos uploaded:   ${uploaded}`);
  console.log(`  Photos skipped:    ${skipped}`);
  console.log(`  Skipped (pre-${year}): ${skippedByAge}`);
  console.log(`  Failed downloads:  ${failed}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

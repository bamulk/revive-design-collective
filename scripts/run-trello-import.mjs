#!/usr/bin/env node
// Runs the chunked Trello import against Supabase via the Postgres REST/RPC
// path. We use `postgres` (pg compatible) via the public Supabase REST API's
// /rest/v1/rpc isn't general SQL — so instead we shell out to pg via the
// supabase-js client's storage of a service_role JWT + the Postgres direct
// connection. Simpler: use node-postgres with the project's connection string.
//
// Reads ~/.env.local-style values from .env.local for SUPABASE_DB_URL or
// reconstructs from NEXT_PUBLIC_SUPABASE_URL + a SUPABASE_DB_PASSWORD.
//
// Usage:
//   node scripts/run-trello-import.mjs              — skip existing cards
//   node scripts/run-trello-import.mjs --overwrite  — re-sync from Trello
//
// In --overwrite mode the upsert updates Trello-sourced fields on
// already-imported cards: address, status, stage_date, destage_date,
// amount, lockbox_code, notes. App-only fields (package_key, photos,
// signatures, invoices, paid_at, primary_only, etc.) are NOT in the
// payload, so they stay intact — Postgres only updates columns the
// upsert provides.
//
// This script imports stages via the Supabase JS client using the service
// role key, which bypasses RLS. We don't need raw SQL execution — we just
// translate each generated INSERT into a supabase client call.

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing Supabase env (NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY)');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Reload the Trello export and replay it via the JS client.
// Path resolution order:
//   1. First non-flag argv (any string ending in .json)
//   2. ~/Downloads/Revive Design Collective.json
//   3. ~/Downloads/trello-export.json
import os from 'node:os';
const argPath = process.argv.slice(2).find((a) => a.endsWith('.json'));
const candidates = [
  argPath,
  path.join(os.homedir(), 'Downloads', 'Revive Design Collective.json'),
  path.join(os.homedir(), 'Downloads', 'trello-export.json'),
].filter(Boolean);
const exportPath = candidates.find((p) => fs.existsSync(p));
if (!exportPath) {
  console.error(
    'Could not find a Trello export. Tried:\n  ' + candidates.join('\n  '),
  );
  process.exit(1);
}
console.log('Using export:', exportPath);
const data = JSON.parse(fs.readFileSync(exportPath, 'utf8'));

const LIST_TO_STATUS = {
  'Upcoming Stages': 'scheduled',
  'Scheduled Stages': 'scheduled',
  'Current Stages': 'staged',
  'Destages': 'destaged',
  // Was 'paid' originally; the schema later renamed that bucket to
  // 'completed'. Keep the mapping in sync with the CHECK constraint.
  'Completed': 'completed',
};
const listsById = Object.fromEntries(data.lists.map(l => [l.id, l]));
const F_CLIENT = data.customFields.find(f => f.name.trim() === 'Client')?.id;
const F_DATE_STAGED = data.customFields.find(f => f.name.trim() === 'Date Staged')?.id;
const F_DATE_DESTAGED = data.customFields.find(f => f.name.trim() === 'Date Destaged')?.id;
const F_AMOUNT = data.customFields.find(f => f.name.trim() === 'Amount Paid')?.id;
const F_LOCKBOX = data.customFields.find(f => f.name.trim().toLowerCase().startsWith('lockbox'))?.id;

// Fetch all clients (any source). Normalize the key to lower-cased,
// whitespace-collapsed form so 'Cap City Construction' and 'cap city
// construction LLC' don't both miss the same Cap City record.
function normalizeName(s) {
  return (s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/,?\s*(llc|inc|co|corp)\.?$/, '')
    .trim();
}

console.log('Fetching clients…');
const clientByName = new Map();
let from = 0;
const PAGE = 1000;
while (true) {
  const { data: rows, error } = await supabase
    .from('clients')
    .select('id, name')
    .range(from, from + PAGE - 1);
  if (error) throw error;
  for (const r of rows) clientByName.set(normalizeName(r.name), r.id);
  if (rows.length < PAGE) break;
  from += PAGE;
}
console.log('Clients indexed:', clientByName.size);

/**
 * Find or create a client with the given display name. Returns the
 * UUID. The lookup uses the normalized form so "Cap City Construction"
 * and "cap city construction LLC" map to the same record.
 */
async function ensureClient(displayName) {
  const key = normalizeName(displayName);
  const existing = clientByName.get(key);
  if (existing) return existing;
  const { data, error } = await supabase
    .from('clients')
    .insert({ name: displayName.trim(), imported_from: 'trello' })
    .select('id')
    .single();
  if (error) throw error;
  clientByName.set(key, data.id);
  console.log('  + created client:', displayName.trim());
  return data.id;
}

// Build stage rows
const rows = [];
for (const c of data.cards) {
  if (c.closed) continue;
  const listName = listsById[c.idList]?.name?.trim();
  const status = LIST_TO_STATUS[listName];
  if (!status) continue;
  const cf = c.customFieldItems || [];
  const get = id => cf.find(x => x.idCustomField === id);
  let clientName = get(F_CLIENT)?.value?.text?.trim();
  if (!clientName) {
    const m = (c.name || '').match(/^([^—\-–]+?)\s*[—\-–]\s*(.+)$/);
    if (m) clientName = m[1].trim();
  }
  if (!clientName) clientName = 'Imported — Unknown';
  // ensureClient creates missing clients on the fly so we don't drop
  // 40+ cards just because their client wasn't in the prior import.
  const clientId = await ensureClient(clientName);
  const dateStaged = get(F_DATE_STAGED)?.value?.date;
  const dateDestaged = get(F_DATE_DESTAGED)?.value?.date;
  let stageDate = dateStaged ? dateStaged.slice(0, 10) : null;
  if (!stageDate && c.id) {
    const ts = parseInt(c.id.slice(0, 8), 16);
    if (Number.isFinite(ts) && ts > 0) {
      stageDate = new Date(ts * 1000).toISOString().slice(0, 10);
    }
  }
  rows.push({
    client_id: clientId,
    address: (c.name || '').trim() || '(no address)',
    status,
    stage_date: stageDate,
    destage_date: dateDestaged ? dateDestaged.slice(0, 10) : null,
    amount: get(F_AMOUNT)?.value?.number ?? 0,
    lockbox_code: get(F_LOCKBOX)?.value?.text?.trim() || null,
    notes: (c.desc || '').trim() || null,
    trello_card_id: c.id,
  });
}

console.log('Stages to insert:', rows.length);

// --overwrite flag controls whether existing trello_card_id rows get
// updated with the latest Trello data (true) or skipped (false, default).
const OVERWRITE = process.argv.includes('--overwrite');
console.log('Mode:', OVERWRITE ? 'OVERWRITE existing rows' : 'skip existing rows');

const BATCH = 200;
let touched = 0;
for (let i = 0; i < rows.length; i += BATCH) {
  const chunk = rows.slice(i, i + BATCH);
  const { data: result, error } = await supabase
    .from('stages')
    .upsert(chunk, {
      onConflict: 'trello_card_id',
      ignoreDuplicates: !OVERWRITE,
    })
    .select('id');
  if (error) {
    console.error('Batch', i, 'failed:', error);
    process.exit(1);
  }
  touched += result?.length ?? 0;
  console.log(
    'Batch',
    i / BATCH + 1,
    '/',
    Math.ceil(rows.length / BATCH),
    '→',
    result?.length ?? 0,
    OVERWRITE ? 'upserted' : 'new',
  );
}
console.log(
  'Done.',
  OVERWRITE ? 'Upserted:' : 'Newly inserted:',
  touched,
  '/',
  rows.length,
);

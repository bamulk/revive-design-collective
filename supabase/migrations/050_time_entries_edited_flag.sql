-- Backfilled into the repo from the live DB (applied via MCP as
-- 050_time_entries_edited_flag). Written idempotently so a clean
-- `supabase db reset` rebuilds the live schema. Repo docs only.

-- Marks an entry that was manually added or had its times edited (vs a
-- plain clock-in/out), so it can be tagged in the UI.
alter table public.time_entries
  add column if not exists edited boolean not null default false;

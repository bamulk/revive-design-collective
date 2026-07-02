-- Backfilled into the repo from the live DB (applied via MCP as
-- 042_stager_availability). Written idempotently so a clean
-- `supabase db reset` rebuilds the live schema. Repo docs only.

-- Per-day availability set by stagers / lead stagers. A row means the
-- stager marked themselves AVAILABLE on that date. Absence of a row =
-- not marked available. Admins read all of it on the Plan page to pick
-- from stagers who are free that day.
create table if not exists public.stager_availability (
  id uuid primary key default gen_random_uuid(),
  stager_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  created_at timestamptz not null default now(),
  unique (stager_id, date)
);

create index if not exists stager_availability_date_idx
  on public.stager_availability(date);

alter table public.stager_availability enable row level security;

-- Any internal team member (admin / stager / lead_stager) can read the
-- whole availability set — the Plan page needs everyone's to surface
-- who's free per day.
drop policy if exists "internal read availability" on public.stager_availability;
create policy "internal read availability"
  on public.stager_availability
  for select
  using (is_internal_user());

-- A team member can only create their own availability rows.
drop policy if exists "own insert availability" on public.stager_availability;
create policy "own insert availability"
  on public.stager_availability
  for insert
  with check (stager_id = auth.uid() and is_internal_user());

-- A team member can only remove their own availability rows.
drop policy if exists "own delete availability" on public.stager_availability;
create policy "own delete availability"
  on public.stager_availability
  for delete
  using (stager_id = auth.uid());

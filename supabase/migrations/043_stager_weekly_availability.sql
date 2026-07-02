-- Backfilled into the repo from the live DB (applied via MCP as
-- 043_stager_weekly_availability). Written idempotently so a clean
-- `supabase db reset` rebuilds the live schema. Repo docs only.

-- Recurring weekly availability: a row means the stager is available on
-- that weekday by default (0=Sun .. 6=Sat). Set once, applies every week.
create table if not exists public.stager_weekly_availability (
  id uuid primary key default gen_random_uuid(),
  stager_id uuid not null references auth.users(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  created_at timestamptz not null default now(),
  unique (stager_id, weekday)
);

alter table public.stager_weekly_availability enable row level security;

drop policy if exists "internal read weekly availability" on public.stager_weekly_availability;
create policy "internal read weekly availability"
  on public.stager_weekly_availability
  for select using (is_internal_user());

drop policy if exists "own insert weekly availability" on public.stager_weekly_availability;
create policy "own insert weekly availability"
  on public.stager_weekly_availability
  for insert with check (stager_id = auth.uid() and is_internal_user());

drop policy if exists "own delete weekly availability" on public.stager_weekly_availability;
create policy "own delete weekly availability"
  on public.stager_weekly_availability
  for delete using (stager_id = auth.uid());

-- The per-date table now holds explicit OVERRIDES of the weekly default.
-- `available` says whether the override marks the day on or off. Existing
-- rows all meant "available", so true is the right default/backfill.
alter table public.stager_availability
  add column if not exists available boolean not null default true;

-- Toggling an existing override (true <-> false) is an UPDATE via upsert,
-- so own-row UPDATE must be permitted alongside the existing insert/delete.
drop policy if exists "own update availability" on public.stager_availability;
create policy "own update availability"
  on public.stager_availability
  for update
  using (stager_id = auth.uid())
  with check (stager_id = auth.uid());

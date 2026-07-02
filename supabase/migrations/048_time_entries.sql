-- Backfilled into the repo from the live DB (applied via MCP as
-- 048_time_entries). Written idempotently so a clean
-- `supabase db reset` rebuilds the live schema. Repo docs only.

create table if not exists public.time_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  clock_in timestamptz not null,
  clock_out timestamptz,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists time_entries_user_idx on public.time_entries(user_id, clock_in desc);

-- One open (not-yet-clocked-out) entry per user at a time.
create unique index if not exists time_entries_one_open_per_user
  on public.time_entries(user_id) where (clock_out is null);

alter table public.time_entries enable row level security;

-- Team members manage their OWN entries; admins manage ALL (payroll review).
drop policy if exists time_entries_own_all on public.time_entries;
create policy time_entries_own_all on public.time_entries
  for all to authenticated
  using (is_internal_user() and user_id = (select auth.uid()))
  with check (is_internal_user() and user_id = (select auth.uid()));

drop policy if exists time_entries_admin_all on public.time_entries;
create policy time_entries_admin_all on public.time_entries
  for all to authenticated
  using (is_admin())
  with check (is_admin());

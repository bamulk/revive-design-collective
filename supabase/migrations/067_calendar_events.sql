-- Manual calendar entries that aren't stages — holidays, warehouse days,
-- vacations, consults. Rendered on the Calendar alongside stage/destage
-- pills. Admins manage them; every internal user can see them.
create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  event_date date not null,
  -- Optional last day for multi-day entries (inclusive). Null = one day.
  end_date date,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists calendar_events_date_idx
  on public.calendar_events(event_date);

alter table public.calendar_events enable row level security;

-- Everyone on the team sees them.
drop policy if exists calendar_events_read on public.calendar_events;
create policy calendar_events_read on public.calendar_events
  for select to authenticated using (is_internal_user());

-- Only admins create / edit / remove.
drop policy if exists calendar_events_admin_write on public.calendar_events;
create policy calendar_events_admin_write on public.calendar_events
  for all to authenticated using (is_admin()) with check (is_admin());

-- Backfilled into the repo from the live DB (applied via MCP as
-- 047_vehicle_maintenance_tracker). Written idempotently so a clean
-- `supabase db reset` rebuilds the live schema. Repo docs only.
-- Note: the fleet seed at the bottom is unguarded — it runs once on a
-- fresh reset; don't re-run this file against an already-seeded DB.

-- Vehicles & trailers fleet
create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('vehicle','trailer')),
  current_mileage integer,
  position integer not null default 0,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

-- Oil changes + general services (the maintenance log)
create table if not exists public.vehicle_service_logs (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  kind text not null check (kind in ('oil_change','service')),
  performed_on date not null default current_date,
  mileage integer,
  cost numeric(10,2),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists vehicle_service_logs_vehicle_idx
  on public.vehicle_service_logs(vehicle_id, performed_on desc);

-- Issue requests reported against a vehicle/trailer
create table if not exists public.vehicle_issues (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  description text not null,
  status text not null default 'open' check (status in ('open','resolved')),
  reported_by uuid references auth.users(id) on delete set null,
  reported_at timestamptz not null default now(),
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists vehicle_issues_vehicle_idx on public.vehicle_issues(vehicle_id, status);

-- RLS: any team member (internal user) has full access; the app/server-
-- action layer restricts admin-only operations (service logs, resolve,
-- rename). Mirrors the stages/clients pattern.
alter table public.vehicles enable row level security;
alter table public.vehicle_service_logs enable row level security;
alter table public.vehicle_issues enable row level security;

drop policy if exists vehicles_internal_all on public.vehicles;
create policy vehicles_internal_all on public.vehicles
  for all to authenticated using (is_internal_user()) with check (is_internal_user());
drop policy if exists vehicle_service_logs_internal_all on public.vehicle_service_logs;
create policy vehicle_service_logs_internal_all on public.vehicle_service_logs
  for all to authenticated using (is_internal_user()) with check (is_internal_user());
drop policy if exists vehicle_issues_internal_all on public.vehicle_issues;
create policy vehicle_issues_internal_all on public.vehicle_issues
  for all to authenticated using (is_internal_user()) with check (is_internal_user());

-- Seed the fleet (rename in-app).
insert into public.vehicles (name, kind, position) values
  ('Vehicle 1','vehicle',1),
  ('Vehicle 2','vehicle',2),
  ('Vehicle 3','vehicle',3),
  ('Trailer 1','trailer',4),
  ('Trailer 2','trailer',5),
  ('Trailer 3','trailer',6);

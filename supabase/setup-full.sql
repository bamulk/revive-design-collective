-- Revive Design Collective — full database setup
-- Generated from schema.sql + all migrations. Run once in the Supabase SQL editor of a FRESH project.

-- ============================================================
-- schema.sql
-- ============================================================
-- Run this in your Supabase SQL editor.

create extension if not exists "pgcrypto";

-- ============ profiles (employees) ============
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text not null,
  phone text,
  role text not null default 'employee' check (role in ('admin','employee')),
  created_at timestamptz not null default now()
);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name',''));
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============ clients ============
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  phone text,
  address text,
  notes text,
  created_at timestamptz not null default now()
);

-- ============ stages ============
create table if not exists public.stages (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  assigned_to uuid references public.profiles(id) on delete set null,
  address text not null,
  amount numeric(12,2) not null default 0,
  status text not null default 'scheduled' check (status in ('scheduled','staged','destaged','completed','cancelled')),
  stage_date date,
  destage_date date,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists stages_client_idx on public.stages(client_id);
create index if not exists stages_status_idx on public.stages(status);

-- ============ stage_photos ============
create table if not exists public.stage_photos (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references public.stages(id) on delete cascade,
  storage_path text not null,
  caption text,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists stage_photos_stage_idx on public.stage_photos(stage_id);

-- ============ stage_tasks (checklist items) ============
create table if not exists public.stage_tasks (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references public.stages(id) on delete cascade,
  title text not null,
  is_done boolean not null default false,
  position integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  completed_by uuid references public.profiles(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists stage_tasks_stage_idx on public.stage_tasks(stage_id);
create index if not exists stage_tasks_position_idx on public.stage_tasks(stage_id, position);

-- ============ RLS ============
alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.stages enable row level security;
alter table public.stage_photos enable row level security;
alter table public.stage_tasks enable row level security;

-- helper: is admin
create or replace function public.is_admin() returns boolean
language sql stable security definer as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- profiles policies
drop policy if exists "profiles_select_all_authed" on public.profiles;
create policy "profiles_select_all_authed" on public.profiles
  for select using (auth.role() = 'authenticated');

drop policy if exists "profiles_update_self_or_admin" on public.profiles;
create policy "profiles_update_self_or_admin" on public.profiles
  for update using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles_admin_insert" on public.profiles;
create policy "profiles_admin_insert" on public.profiles
  for insert with check (public.is_admin());

drop policy if exists "profiles_admin_delete" on public.profiles;
create policy "profiles_admin_delete" on public.profiles
  for delete using (public.is_admin());

-- clients policies (any authed user can CRUD)
drop policy if exists "clients_authed_all" on public.clients;
create policy "clients_authed_all" on public.clients
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- stages policies
drop policy if exists "stages_authed_all" on public.stages;
create policy "stages_authed_all" on public.stages
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- stage_photos policies
drop policy if exists "stage_photos_authed_all" on public.stage_photos;
create policy "stage_photos_authed_all" on public.stage_photos
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- stage_tasks policies
drop policy if exists "stage_tasks_authed_all" on public.stage_tasks;
create policy "stage_tasks_authed_all" on public.stage_tasks
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ============ storage bucket for photos ============
insert into storage.buckets (id, name, public)
values ('stage-photos', 'stage-photos', false)
on conflict (id) do nothing;

drop policy if exists "stage_photos_read" on storage.objects;
create policy "stage_photos_read" on storage.objects
  for select using (bucket_id = 'stage-photos' and auth.role() = 'authenticated');

drop policy if exists "stage_photos_write" on storage.objects;
create policy "stage_photos_write" on storage.objects
  for insert with check (bucket_id = 'stage-photos' and auth.role() = 'authenticated');

drop policy if exists "stage_photos_delete" on storage.objects;
create policy "stage_photos_delete" on storage.objects
  for delete using (bucket_id = 'stage-photos' and auth.role() = 'authenticated');

-- ============================================================
-- 001_stage_tasks.sql
-- ============================================================
-- Checklist items for each stage.
-- Run this in your Supabase SQL editor.

create table if not exists public.stage_tasks (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references public.stages(id) on delete cascade,
  title text not null,
  is_done boolean not null default false,
  position integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  completed_by uuid references public.profiles(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists stage_tasks_stage_idx on public.stage_tasks(stage_id);
create index if not exists stage_tasks_position_idx on public.stage_tasks(stage_id, position);

alter table public.stage_tasks enable row level security;

drop policy if exists "stage_tasks_authed_all" on public.stage_tasks;
create policy "stage_tasks_authed_all" on public.stage_tasks
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ============================================================
-- 002_signatures.sql
-- ============================================================
-- Signature request tracking on stages.
-- Run this in your Supabase SQL editor.

alter table public.stages
  add column if not exists signature_envelope_id text,
  add column if not exists signature_status text,
  add column if not exists signature_sent_at timestamptz,
  add column if not exists signature_completed_at timestamptz,
  add column if not exists signature_signer_email text,
  add column if not exists signed_pdf_url text;

-- Storage bucket for generated contract PDFs (both the unsigned template we
-- hand to SignatureAPI and the signed deliverable we cache after completion).
-- Public so SignatureAPI can fetch the document URL we pass when creating an
-- envelope. Path obscurity + random filenames keep it effectively private.
insert into storage.buckets (id, name, public)
values ('contracts', 'contracts', true)
on conflict (id) do nothing;

drop policy if exists "contracts_public_read" on storage.objects;
create policy "contracts_public_read" on storage.objects
  for select using (bucket_id = 'contracts');

drop policy if exists "contracts_authed_write" on storage.objects;
create policy "contracts_authed_write" on storage.objects
  for insert with check (bucket_id = 'contracts' and auth.role() = 'authenticated');

-- ============================================================
-- 003_pricing.sql
-- ============================================================
-- Package + add-on pricing on stages.
-- `amount` is the computed total (existing column); these columns capture the
-- breakdown so the contract and invoice can itemize.
--
-- Run this in your Supabase SQL editor.

alter table public.stages
  add column if not exists package_key text,
  add column if not exists add_ons jsonb not null default '[]'::jsonb,
  add column if not exists discount numeric not null default 0;

-- ============================================================
-- 004_lockbox.sql
-- ============================================================
-- Lockbox code for a stage's property — stored as text so leading zeros and
-- non-numeric codes (e.g. alphanumeric Supra codes) are preserved.
-- Run this in your Supabase SQL editor.

alter table public.stages
  add column if not exists lockbox_code text;

-- ============================================================
-- 005_completed_status.sql
-- ============================================================
-- Drop the old "invoiced" and "paid" statuses; collapse both into "completed".
-- Run this in your Supabase SQL editor (or already applied via MCP for prod).

alter table public.stages
  drop constraint if exists stages_status_check;

update public.stages set status = 'completed'
  where status in ('paid', 'invoiced');

alter table public.stages
  add constraint stages_status_check
  check (status in ('scheduled','staged','destaged','completed','cancelled'));

alter table public.stages
  alter column status set default 'scheduled';

-- ============================================================
-- 006_contract_template.sql
-- ============================================================
-- Single-row table holding the editable parts of the staging agreement.
-- Run this in your Supabase SQL editor (or already applied via MCP for prod).

create table if not exists public.contract_template (
  id integer primary key default 1 check (id = 1),
  company_name text not null default 'Revive Design Collective',
  intro text,
  terms jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.contract_template (id, company_name, intro, terms)
values (
  1,
  'Revive Design Collective',
  null,
  jsonb_build_array(
    jsonb_build_object('title', 'Services',     'body', 'Stager will provide home staging services at the Property, including furniture and decor selection, placement, and removal on the destage date.'),
    jsonb_build_object('title', 'Fee',          'body', 'Client agrees to pay the total fee shown above. An invoice will be issued on the stage date. Payment is due within 14 days of the invoice date unless otherwise agreed in writing.'),
    jsonb_build_object('title', 'Access',       'body', 'Client will provide Stager reasonable access to the Property on the stage and destage dates. Delays caused by inaccessibility may incur rescheduling fees.'),
    jsonb_build_object('title', 'Care of Property', 'body', 'Stager will exercise reasonable care. Stager is not responsible for pre-existing conditions or damage caused by third parties.'),
    jsonb_build_object('title', 'Inventory',    'body', 'All furniture and decor brought to the Property remain the property of Stager and will be removed on the destage date. Client agrees not to move, sell, or otherwise disturb the inventory.'),
    jsonb_build_object('title', 'Cancellation', 'body', 'Cancellations requested less than 72 hours before the stage date may incur a charge of up to 50% of the total fee.'),
    jsonb_build_object('title', 'Entire Agreement', 'body', 'This document is the full agreement between the parties regarding these services.')
  )
)
on conflict (id) do nothing;

alter table public.contract_template enable row level security;

drop policy if exists "contract_template_read" on public.contract_template;
create policy "contract_template_read" on public.contract_template
  for select using (auth.role() = 'authenticated');

drop policy if exists "contract_template_admin_write" on public.contract_template;
create policy "contract_template_admin_write" on public.contract_template
  for update using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'
    )
  );

-- ============================================================
-- 007_invoicing.sql
-- ============================================================
-- Invoice + payment tracking on stages. Run in Supabase SQL editor
-- (already applied via MCP for prod).

alter table public.stages
  add column if not exists invoice_pdf_url text,
  add column if not exists invoice_generated_at timestamptz,
  add column if not exists invoice_sent_at timestamptz,
  add column if not exists paid_at timestamptz,
  add column if not exists payment_method text;

alter table public.stages
  drop constraint if exists stages_payment_method_check;
alter table public.stages
  add constraint stages_payment_method_check
  check (
    payment_method is null
    or payment_method in ('check','cash','zelle','venmo','card','other')
  );

-- ============================================================
-- 008_estimates.sql
-- ============================================================
-- Estimate workflow: a stage with status='estimate' is a pre-workflow
-- record. The client gets a public accept link; accepting flips status
-- to 'scheduled' and the regular workflow takes over.
-- Run via Supabase SQL editor (or already applied via MCP for prod).

alter table public.stages drop constraint if exists stages_status_check;
alter table public.stages
  add constraint stages_status_check
  check (status in ('estimate','scheduled','staged','destaged','completed','cancelled'));

alter table public.stages
  add column if not exists estimate_token text,
  add column if not exists estimate_sent_at timestamptz,
  add column if not exists estimate_accepted_at timestamptz,
  add column if not exists estimate_declined_at timestamptz;

create unique index if not exists stages_estimate_token_uniq
  on public.stages (estimate_token)
  where estimate_token is not null;

-- Anonymous-friendly view used by the public accept page.
-- Drop-then-create (not CREATE OR REPLACE) so re-running the full setup
-- on a DB where migration 054 already widened this view doesn't fail with
-- "cannot drop columns from view".
drop view if exists public.estimate_public;
create view public.estimate_public as
  select
    s.id,
    s.address,
    s.amount,
    s.stage_date,
    s.destage_date,
    s.package_key,
    s.add_ons,
    s.discount,
    s.status,
    s.estimate_token,
    s.estimate_accepted_at,
    s.estimate_declined_at,
    c.name as client_name
  from public.stages s
  left join public.clients c on c.id = s.client_id;

grant select on public.estimate_public to anon, authenticated;

-- ============================================================
-- 009_expenses.sql
-- ============================================================
-- Expense tracking. Income lives on stages (amount + paid_at); expenses
-- get their own table so we can record outflows from CSV imports,
-- manual entry, or future Plaid sync.
-- Run via Supabase SQL editor (or already applied via MCP for prod).

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  amount numeric(12, 2) not null,
  description text not null,
  category text,
  source text default 'manual',
  external_id text,
  created_at timestamptz not null default now()
);

-- Full UNIQUE constraint (not a partial index) so upsert's ON CONFLICT
-- can target it. Postgres treats NULLs as distinct, so manually-added
-- rows that have no external_id still coexist.
alter table public.expenses
  drop constraint if exists expenses_external_id_key;
alter table public.expenses
  add constraint expenses_external_id_key unique (external_id);

create index if not exists expenses_date_idx on public.expenses (date desc);

alter table public.expenses enable row level security;

drop policy if exists "expenses_all_authed" on public.expenses;
create policy "expenses_all_authed" on public.expenses
  for all using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- ============================================================
-- 010_stage_coords.sql
-- ============================================================
-- Cached geocoded coordinates for each stage's address. Filled in the
-- first time a stage page is viewed; subsequent visits skip the
-- geocoder.

alter table public.stages
  add column if not exists lat double precision,
  add column if not exists lng double precision;

-- ============================================================
-- 011_stage_city.sql
-- ============================================================
-- Split the address into number+street ("address") and city.
-- Helps with geocoding accuracy and lets the UI show the city as a
-- subtitle under the street address.
alter table public.stages
  add column if not exists city text;

-- ============================================================
-- 012_property_details.sql
-- ============================================================
-- Property-specific details captured at stage creation: square footage,
-- bedroom count, bathroom count. Bathroom is numeric so 2.5 / 3.5 work.

alter table public.stages
  add column if not exists square_footage integer,
  add column if not exists bedrooms smallint,
  add column if not exists bathrooms numeric(3, 1);

-- ============================================================
-- 013_zillow_url.sql
-- ============================================================
ALTER TABLE stages ADD COLUMN IF NOT EXISTS zillow_url text;

-- ============================================================
-- 014_sms_notifications.sql
-- ============================================================
-- Text-notification scaffolding.
-- - sms_notifications_enabled: per-admin opt-in (default ON)
-- - photo_reminder_sent_at: stamped when the "3-day photo nag"
--   fires so we don't spam admins every day after that.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS sms_notifications_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE stages
  ADD COLUMN IF NOT EXISTS photo_reminder_sent_at timestamp with time zone;

-- ============================================================
-- 015_push_subscriptions.sql
-- ============================================================
-- Web Push subscriptions. One row per (user, device).
-- Endpoint is unique because the browser-issued endpoint is the
-- device identifier; re-subscribing on the same device returns the
-- same endpoint and we just upsert.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx
  ON push_subscriptions(user_id);

-- ============================================================
-- 016_security_hardening.sql
-- ============================================================
-- Lock down post-RLS-audit issues from Supabase database-linter.
--
-- 1. Enable RLS on push_subscriptions (was added in mig 015 without
--    it). Users may only see/manage their own device tokens. The
--    service-role client used in server-side notify.ts bypasses RLS,
--    so cron and action paths continue working.
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "push_subs_owner_select" ON public.push_subscriptions;
DROP POLICY IF EXISTS "push_subs_owner_insert" ON public.push_subscriptions;
DROP POLICY IF EXISTS "push_subs_owner_update" ON public.push_subscriptions;
DROP POLICY IF EXISTS "push_subs_owner_delete" ON public.push_subscriptions;

CREATE POLICY "push_subs_owner_select"
  ON public.push_subscriptions FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "push_subs_owner_insert"
  ON public.push_subscriptions FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "push_subs_owner_update"
  ON public.push_subscriptions FOR UPDATE
  USING (auth.uid() = user_id);
CREATE POLICY "push_subs_owner_delete"
  ON public.push_subscriptions FOR DELETE
  USING (auth.uid() = user_id);

-- 2. Pin search_path on SECURITY DEFINER helpers (prevents
--    schema-shadowing attacks) and revoke direct REST RPC access.
--    Both functions are used internally (handle_new_user via trigger;
--    is_admin from RLS predicates) and don't need API exposure.
ALTER FUNCTION public.handle_new_user() SET search_path = public, pg_temp;
ALTER FUNCTION public.is_admin() SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM anon, authenticated, PUBLIC;

-- 3. Switch the public estimate view from SECURITY DEFINER to
--    SECURITY INVOKER so it runs with the caller's permissions
--    rather than the view-creator's. RLS on the underlying tables
--    still controls visibility for the public accept flow.
ALTER VIEW public.estimate_public SET (security_invoker = on);

-- ============================================================
-- 017_contracts_bucket_restrict_listing.sql
-- ============================================================
-- Drop the broad SELECT policy on the contracts bucket. The bucket
-- is already 'public' so object URLs still resolve for anyone with
-- the link — this policy just allowed listing/enumerating every file.
DROP POLICY IF EXISTS contracts_public_read ON storage.objects;

-- ============================================================
-- 018_rename_role_employee_to_stager.sql
-- ============================================================
-- Rename the non-admin role from "employee" to "stager" to match
-- how Revive Design Collective actually refers to these team members.
--
-- Order matters: drop the CHECK constraint first so the UPDATE can
-- succeed, then add the new constraint that only allows the new value.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;

UPDATE public.profiles SET role = 'stager' WHERE role = 'employee';

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role = ANY (ARRAY['admin'::text, 'stager'::text]));

-- ============================================================
-- 019_profiles_role_default_stager.sql
-- ============================================================
-- The column default still pointed at the old 'employee' value after
-- mig 018 renamed the role. handle_new_user (the auth trigger) only
-- inserts (id, email, full_name) and relies on the column default
-- for role — so every new signup was being created with role='employee'
-- which violated the post-rename CHECK constraint, producing
-- "Database error saving new user" on the invite flow.
ALTER TABLE public.profiles
  ALTER COLUMN role SET DEFAULT 'stager';

-- ============================================================
-- 020_stages_primary_only.sql
-- ============================================================
-- Per-stage "primary only" flag. When true, the crew is staging only
-- the primary living areas (living, kitchen, master) rather than the
-- whole house. Surfaces on the stage detail page so the team knows
-- what to load on the truck.
ALTER TABLE public.stages
  ADD COLUMN IF NOT EXISTS primary_only boolean NOT NULL DEFAULT false;

-- ============================================================
-- 021_stage_photos_trello_attachment_id.sql
-- ============================================================
-- Idempotency stamp for the Trello photo import. The UNIQUE index
-- lets the importer skip attachments it has already saved on a
-- re-run (helpful if the script gets interrupted halfway through).
ALTER TABLE public.stage_photos
  ADD COLUMN IF NOT EXISTS trello_attachment_id text;

CREATE UNIQUE INDEX IF NOT EXISTS stage_photos_trello_attachment_id_key
  ON public.stage_photos(trello_attachment_id)
  WHERE trello_attachment_id IS NOT NULL;

-- ============================================================
-- 022_performance_indexes.sql
-- ============================================================
-- Indexes to speed up the hot query patterns observed in production:
--
--   stages: every list view (groups, board, calendar, dashboard
--     outstanding-invoices, today widget) sorts/filters on stage_date,
--     destage_date, or (status, stage_date) together.
--
--   stage_photos: "first photo per stage" lookups order by created_at,
--     which on ~5K rows was forcing a sequential scan.
CREATE INDEX IF NOT EXISTS stages_stage_date_idx
  ON public.stages (stage_date);

CREATE INDEX IF NOT EXISTS stages_status_stage_date_idx
  ON public.stages (status, stage_date);

CREATE INDEX IF NOT EXISTS stages_destage_date_idx
  ON public.stages (destage_date);

CREATE INDEX IF NOT EXISTS stage_photos_created_at_idx
  ON public.stage_photos (created_at);

-- ============================================================
-- 023_stage_extensions.sql
-- ============================================================
-- Staging extension flow:
--   1. Cron fires 10 days before destage_date, emails client.
--   2. Client clicks the link, lands on /x/{token}, chooses
--      Extend (bump destage_date 60 days, generate a 50% invoice)
--      or Destage (no change, admin gets notified).
ALTER TABLE public.stages
  ADD COLUMN IF NOT EXISTS extension_token text,
  ADD COLUMN IF NOT EXISTS extension_email_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS extension_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extension_invoice_pdf_url text,
  ADD COLUMN IF NOT EXISTS extension_invoice_amount numeric(10, 2),
  ADD COLUMN IF NOT EXISTS extension_invoice_paid_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS stages_extension_token_uniq
  ON public.stages (extension_token)
  WHERE extension_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS stages_destage_date_for_reminder_idx
  ON public.stages (destage_date)
  WHERE status = 'staged' AND extension_email_sent_at IS NULL;

-- ============================================================
-- 024_stage_team_assignments.sql
-- ============================================================
-- Team assignments for the Plan page.
--
-- The admin uses /plan to look ahead at the next few days of stages
-- and destages and assign each job to one of three teams. After picking
-- a team, the admin chooses which stagers from the roster are on that
-- team for that job.
--
-- Modeled per-job (not as a separate teams table) because team
-- membership can shift day-to-day depending on who's available.
ALTER TABLE public.stages
  ADD COLUMN IF NOT EXISTS team text,
  ADD COLUMN IF NOT EXISTS assigned_stager_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

ALTER TABLE public.stages
  DROP CONSTRAINT IF EXISTS stages_team_check;
ALTER TABLE public.stages
  ADD CONSTRAINT stages_team_check
  CHECK (team IS NULL OR team = ANY (ARRAY['grey'::text, 'white'::text, 'little'::text]));

-- Fast lookups for the Plan page: "all jobs with stage_date or
-- destage_date in the next N days".
CREATE INDEX IF NOT EXISTS stages_stage_date_idx
  ON public.stages (stage_date)
  WHERE stage_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS stages_destage_date_idx
  ON public.stages (destage_date)
  WHERE destage_date IS NOT NULL;

-- ============================================================
-- 025_stage_destage_team.sql
-- ============================================================
-- Split team assignments between staging and destaging.
--
-- Migration 024 added a single (team, assigned_stager_ids) pair per
-- stage — but a house's staging crew and destaging crew are often
-- different teams. We keep the original columns as the *stage-day*
-- crew, and add destage_team / destage_stager_ids for the destage day.
ALTER TABLE public.stages
  ADD COLUMN IF NOT EXISTS destage_team text,
  ADD COLUMN IF NOT EXISTS destage_stager_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

ALTER TABLE public.stages
  DROP CONSTRAINT IF EXISTS stages_destage_team_check;
ALTER TABLE public.stages
  ADD CONSTRAINT stages_destage_team_check
  CHECK (destage_team IS NULL OR destage_team = ANY (ARRAY['grey'::text, 'white'::text, 'little'::text]));

-- ============================================================
-- 026_stage_escrow.sql
-- ============================================================
-- Escrow payment flag. When true, the client is paying through escrow,
-- which adds a fixed $350 fee. The fee is included in stages.amount so
-- the invoice and reporting math just works.
ALTER TABLE public.stages
  ADD COLUMN IF NOT EXISTS escrow boolean NOT NULL DEFAULT false;

-- ============================================================
-- 027_stage_listing_status.sql
-- ============================================================
-- Track Zillow listing status on each stage so the admin gets an
-- email the moment a staged property goes pending. Updated daily by
-- /api/cron/check-listing-status.
--
--   listing_status              — last status string from Zillow
--                                 (e.g. "FOR_SALE", "PENDING").
--   listing_status_checked_at   — last successful fetch.
--   listing_pending_notified_at — set when we email the admins about
--                                 a pending transition; prevents
--                                 re-notifying every day.
--   listing_monitor             — admin can opt a stage out of the
--                                 daily check (e.g. off-market jobs).
ALTER TABLE public.stages
  ADD COLUMN IF NOT EXISTS listing_status text,
  ADD COLUMN IF NOT EXISTS listing_status_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS listing_pending_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS listing_monitor boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS stages_listing_monitor_idx
  ON public.stages (status)
  WHERE listing_monitor = true
    AND listing_pending_notified_at IS NULL
    AND zillow_url IS NOT NULL;

-- ============================================================
-- 028_stages_first_photo_path.sql
-- ============================================================
-- Cache the path of the OLDEST stage_photo per stage so list pages
-- can render thumbnails without scanning the whole stage_photos
-- table (~5k rows today). Maintained by trigger on insert + delete.
ALTER TABLE public.stages
  ADD COLUMN IF NOT EXISTS first_photo_storage_path text;

CREATE OR REPLACE FUNCTION public.refresh_stage_first_photo(p_stage_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  next_path text;
BEGIN
  SELECT storage_path
    INTO next_path
    FROM public.stage_photos
    WHERE stage_id = p_stage_id
    ORDER BY created_at ASC
    LIMIT 1;
  UPDATE public.stages
    SET first_photo_storage_path = next_path
    WHERE id = p_stage_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.stage_photos_first_photo_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_stage_first_photo(OLD.stage_id);
    RETURN OLD;
  ELSE
    PERFORM public.refresh_stage_first_photo(NEW.stage_id);
    RETURN NEW;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS stage_photos_first_photo_aiud ON public.stage_photos;
CREATE TRIGGER stage_photos_first_photo_aiud
AFTER INSERT OR DELETE ON public.stage_photos
FOR EACH ROW EXECUTE FUNCTION public.stage_photos_first_photo_trigger();

-- One-time backfill.
UPDATE public.stages s
SET first_photo_storage_path = sp.storage_path
FROM (
  SELECT DISTINCT ON (stage_id) stage_id, storage_path
  FROM public.stage_photos
  ORDER BY stage_id, created_at ASC
) sp
WHERE s.id = sp.stage_id
  AND s.first_photo_storage_path IS DISTINCT FROM sp.storage_path;

-- ============================================================
-- 029_stage_travel_fee.sql
-- ============================================================
-- Optional travel fee on a stage. Two preset tiers — $200 and $300.
-- Defaults to 0 (no fee). Included in stages.amount so the invoice
-- and reporting math just works.
ALTER TABLE public.stages
  ADD COLUMN IF NOT EXISTS travel_fee numeric(10, 2) NOT NULL DEFAULT 0;

-- ============================================================
-- 030_stage_extensions_table.sql
-- ============================================================
-- Per-extension history. Replaces the single set of extension_*
-- columns on stages, which only retained the latest extension's
-- amount / pdf / paid state. The stages columns stick around for
-- backward compat (extension_count is still used as a quick rollup),
-- but the source of truth for individual extensions moves here.
CREATE TABLE IF NOT EXISTS public.stage_extensions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id uuid NOT NULL REFERENCES public.stages(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  extension_date date,
  amount numeric(10, 2) NOT NULL DEFAULT 0,
  paid_at timestamptz,
  pdf_url text,
  pdf_sent_at timestamptz,
  source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'auto'))
);

CREATE INDEX IF NOT EXISTS stage_extensions_stage_id_idx
  ON public.stage_extensions (stage_id, created_at);

ALTER TABLE public.stage_extensions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stage_extensions_authed_all ON public.stage_extensions;
CREATE POLICY stage_extensions_authed_all
  ON public.stage_extensions
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Backfill from the latest known extension state on stages. Older
-- extensions (count > 1) lose detail — there's no per-row history
-- to reconstruct.
INSERT INTO public.stage_extensions (
  stage_id, extension_date, amount, paid_at, pdf_url, source
)
SELECT
  s.id,
  s.destage_date,
  COALESCE(s.extension_invoice_amount, 0),
  s.extension_invoice_paid_at,
  s.extension_invoice_pdf_url,
  CASE WHEN s.extension_invoice_pdf_url IS NULL THEN 'manual' ELSE 'auto' END
FROM public.stages s
WHERE COALESCE(s.extension_count, 0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.stage_extensions e WHERE e.stage_id = s.id
  );

-- ============================================================
-- 031_stage_extension_token_consumed.sql
-- ============================================================
-- When the client confirms or declines an extension on /x/{token},
-- we used to NULL out stages.extension_token. That left the page
-- unable to find the stage on the next request (the "thanks for your
-- response" confirmation never rendered — users saw a 404).
--
-- New column: extension_token_consumed. On a successful extend or
-- destage choice, we MOVE the token from extension_token into here
-- instead of nulling it. The /x page looks up by either column;
-- server actions still only fire when the active column matches.
ALTER TABLE public.stages
  ADD COLUMN IF NOT EXISTS extension_token_consumed text;

CREATE INDEX IF NOT EXISTS stages_extension_token_consumed_idx
  ON public.stages (extension_token_consumed)
  WHERE extension_token_consumed IS NOT NULL;

-- ============================================================
-- 032_stage_neighborhood.sql
-- ============================================================
-- General-area label for a stage (e.g. "East Sacramento", "Natomas").
-- Zillow doesn't expose neighborhood through any endpoint we can
-- reach, so this is reverse-geocoded from the cached lat/lng via
-- Nominatim (suburb / neighbourhood / city_district) and cached here.
ALTER TABLE public.stages
  ADD COLUMN IF NOT EXISTS neighborhood text;

-- ============================================================
-- 033_client_portal_access.sql
-- ============================================================
-- Backfilled into the repo from the live DB (applied via MCP as
-- 033_client_portal_access). Written idempotently so a clean
-- `supabase db reset` rebuilds the live schema. Repo docs only.

-- ----- 1. Link clients to auth users -----
alter table public.clients
  add column if not exists auth_user_id uuid references auth.users(id) on delete set null;

create unique index if not exists clients_auth_user_id_unique
  on public.clients(auth_user_id)
  where auth_user_id is not null;

-- ----- 2. Role-check helpers (SECURITY DEFINER avoids RLS recursion on profiles) -----
create or replace function public.is_internal_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin','stager')
  );
$$;
grant execute on function public.is_internal_user() to authenticated;

create or replace function public.current_client_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.clients where auth_user_id = auth.uid() limit 1;
$$;
grant execute on function public.current_client_id() to authenticated;

-- ----- 3. stages: internal full access; client SELECT own -----
drop policy if exists stages_authed_all on public.stages;
drop policy if exists stages_internal_all on public.stages;
create policy stages_internal_all on public.stages
  for all to authenticated
  using (public.is_internal_user())
  with check (public.is_internal_user());
drop policy if exists stages_client_select on public.stages;
create policy stages_client_select on public.stages
  for select to authenticated
  using (client_id = public.current_client_id());

-- ----- 4. stage_extensions: internal full; client SELECT own -----
drop policy if exists stage_extensions_authed_all on public.stage_extensions;
drop policy if exists stage_extensions_internal_all on public.stage_extensions;
create policy stage_extensions_internal_all on public.stage_extensions
  for all to authenticated
  using (public.is_internal_user())
  with check (public.is_internal_user());
drop policy if exists stage_extensions_client_select on public.stage_extensions;
create policy stage_extensions_client_select on public.stage_extensions
  for select to authenticated
  using (
    exists (
      select 1 from public.stages s
      where s.id = stage_extensions.stage_id
        and s.client_id = public.current_client_id()
    )
  );

-- ----- 5. stage_photos / stage_tasks / expenses: internal-only -----
drop policy if exists stage_photos_authed_all on public.stage_photos;
drop policy if exists stage_photos_internal_all on public.stage_photos;
create policy stage_photos_internal_all on public.stage_photos
  for all to authenticated
  using (public.is_internal_user())
  with check (public.is_internal_user());

drop policy if exists stage_tasks_authed_all on public.stage_tasks;
drop policy if exists stage_tasks_internal_all on public.stage_tasks;
create policy stage_tasks_internal_all on public.stage_tasks
  for all to authenticated
  using (public.is_internal_user())
  with check (public.is_internal_user());

drop policy if exists expenses_all_authed on public.expenses;
drop policy if exists expenses_internal_all on public.expenses;
create policy expenses_internal_all on public.expenses
  for all to authenticated
  using (public.is_internal_user())
  with check (public.is_internal_user());

-- ----- 6. clients: internal full; client SELECT own row -----
drop policy if exists clients_authed_all on public.clients;
drop policy if exists clients_internal_all on public.clients;
create policy clients_internal_all on public.clients
  for all to authenticated
  using (public.is_internal_user())
  with check (public.is_internal_user());
drop policy if exists clients_self_select on public.clients;
create policy clients_self_select on public.clients
  for select to authenticated
  using (auth_user_id = auth.uid());

-- ----- 7. profiles: internal-only SELECT so portal clients can't enumerate the team -----
drop policy if exists profiles_select_all_authed on public.profiles;
drop policy if exists profiles_select_internal on public.profiles;
create policy profiles_select_internal on public.profiles
  for select to authenticated
  using (public.is_internal_user() or id = auth.uid());

-- ============================================================
-- 034_plaid_integration.sql
-- ============================================================
-- Backfilled into the repo from the live DB (applied via MCP as
-- 034_plaid_integration). Written idempotently so a clean
-- `supabase db reset` rebuilds the live schema. Repo docs only.

-- One row per linked Plaid Item (bank connection). access_token is the
-- long-lived server credential — never expose to the browser.
create table if not exists public.plaid_items (
  id uuid primary key default gen_random_uuid(),
  item_id text not null unique,
  access_token text not null,
  institution_id text,
  institution_name text,
  -- Cursor for /transactions/sync — null means "fetch from beginning".
  cursor text,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

alter table public.plaid_items enable row level security;

-- Plaid items are internal-only. Service-role bypasses RLS for cron/
-- webhook writes; this just makes sure no client can ever see them.
drop policy if exists plaid_items_internal_all on public.plaid_items;
create policy plaid_items_internal_all on public.plaid_items
  for all to authenticated
  using (public.is_internal_user())
  with check (public.is_internal_user());

-- Extend expenses with the Plaid dedup key. UNIQUE so the same Plaid
-- transaction can't land twice on retries / cursor replays.
alter table public.expenses
  add column if not exists plaid_transaction_id text;
create unique index if not exists expenses_plaid_transaction_id_unique
  on public.expenses(plaid_transaction_id)
  where plaid_transaction_id is not null;

alter table public.expenses
  add column if not exists pending boolean not null default false;
alter table public.expenses
  add column if not exists plaid_account_id text;

-- ============================================================
-- 035_stage_payments.sql
-- ============================================================
-- Backfilled into the repo from the live DB (applied via MCP as
-- 035_stage_payments). Written idempotently so a clean
-- `supabase db reset` rebuilds the live schema. Repo docs only.

-- Per-stage payments ledger. N rows per stage, each a real payment
-- event (amount + date + method + free-form note). stages.paid_at is
-- kept in sync by trigger so existing "is this paid?" queries stay
-- meaningful (it now means "fully paid on").
create table if not exists public.stage_payments (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references public.stages(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  paid_at date not null,
  method text,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists stage_payments_stage_id_idx on public.stage_payments(stage_id);
create index if not exists stage_payments_paid_at_idx on public.stage_payments(paid_at);

alter table public.stage_payments enable row level security;

-- Internal users can do everything; clients can SELECT payments tied
-- to their own stages.
drop policy if exists stage_payments_internal_all on public.stage_payments;
create policy stage_payments_internal_all on public.stage_payments
  for all to authenticated
  using (public.is_internal_user())
  with check (public.is_internal_user());
drop policy if exists stage_payments_client_select on public.stage_payments;
create policy stage_payments_client_select on public.stage_payments
  for select to authenticated
  using (
    exists (
      select 1 from public.stages s
      where s.id = stage_payments.stage_id
        and s.client_id = public.current_client_id()
    )
  );

-- Keep stages.paid_at in sync with the payments ledger. The stage is
-- "fully paid" when the sum of payments >= the stage amount; paid_at
-- becomes the most recent payment's date. Otherwise paid_at is null
-- (partial / unpaid).
create or replace function public.refresh_stage_paid_status() returns trigger
language plpgsql as $$
declare
  v_stage_id uuid;
  v_total numeric;
  v_last_paid date;
  v_amount numeric;
begin
  v_stage_id := coalesce(NEW.stage_id, OLD.stage_id);
  select coalesce(sum(amount), 0), max(paid_at)
    into v_total, v_last_paid
    from public.stage_payments where stage_id = v_stage_id;
  select amount into v_amount from public.stages where id = v_stage_id;
  if v_amount is not null and v_total >= v_amount then
    update public.stages
       set paid_at = (v_last_paid::timestamp at time zone 'UTC')
     where id = v_stage_id;
  else
    update public.stages set paid_at = null where id = v_stage_id;
  end if;
  return null;
end $$;

drop trigger if exists stage_payments_refresh_paid on public.stage_payments;
create trigger stage_payments_refresh_paid
after insert or update or delete on public.stage_payments
for each row execute function public.refresh_stage_paid_status();

-- If the stage's amount changes, re-evaluate paid status against the
-- existing payments. Otherwise raising the amount on a fully-paid
-- stage would leave paid_at incorrectly set.
create or replace function public.refresh_stage_paid_on_amount_change() returns trigger
language plpgsql as $$
declare
  v_total numeric;
  v_last_paid date;
begin
  if NEW.amount is distinct from OLD.amount then
    select coalesce(sum(amount), 0), max(paid_at)
      into v_total, v_last_paid
      from public.stage_payments where stage_id = NEW.id;
    if NEW.amount is not null and v_total >= NEW.amount then
      NEW.paid_at := (v_last_paid::timestamp at time zone 'UTC');
    else
      NEW.paid_at := null;
    end if;
  end if;
  return NEW;
end $$;

drop trigger if exists stages_refresh_paid_on_amount_change on public.stages;
create trigger stages_refresh_paid_on_amount_change
before update of amount on public.stages
for each row execute function public.refresh_stage_paid_on_amount_change();

-- Backfill: every stage that already has paid_at set + a positive
-- amount gets a single full-amount payment row in the ledger.
insert into public.stage_payments (stage_id, amount, paid_at, method, note)
select s.id, s.amount, s.paid_at::date, s.payment_method,
       'Backfilled from legacy paid_at'
from public.stages s
where s.paid_at is not null
  and s.amount is not null
  and s.amount > 0
  and not exists (
    select 1 from public.stage_payments p where p.stage_id = s.id
  );

-- ============================================================
-- 036_stage_length_days.sql
-- ============================================================
-- Backfilled into the repo from the live DB (applied via MCP as
-- 036_stage_length_days). Written idempotently so a clean
-- `supabase db reset` rebuilds the live schema. Repo docs only.

-- Allow stages to opt into an extended 90-day rental period. Default
-- 60 matches the legacy contract length so existing data is unchanged.
-- Check constraint keeps the column to the two values we support; if
-- more lengths are needed later, drop and replace this.
alter table public.stages
  add column if not exists stage_length_days int not null default 60;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'stages_stage_length_days_check'
  ) then
    alter table public.stages
      add constraint stages_stage_length_days_check
      check (stage_length_days in (60, 90));
  end if;
end$$;

-- ============================================================
-- 037_secondary_recipient.sql
-- ============================================================
-- Backfilled into the repo from the live DB (applied via MCP as
-- 037_secondary_recipient). Written idempotently so a clean
-- `supabase db reset` rebuilds the live schema. Repo docs only.

-- Optional second person on a stage / estimate. Used when the client
-- splits payment with the homeowner (or the homeowner pays directly).
-- Both names appear on the contract, both signatures are required,
-- and both addresses are CC'd on the invoice + estimate emails.
alter table public.stages
  add column if not exists secondary_recipient_name text,
  add column if not exists secondary_recipient_email text;

-- ============================================================
-- 038_lead_stager_role.sql
-- ============================================================
-- Backfilled into the repo from the live DB (applied via MCP as
-- 038_lead_stager_role). Written idempotently so a clean
-- `supabase db reset` rebuilds the live schema. Repo docs only.

-- Extend the internal-user check to include the new 'lead_stager' role.
-- All RLS policies on stages / stage_extensions / clients / etc. that
-- call is_internal_user() automatically pick this up.
create or replace function public.is_internal_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('admin','stager','lead_stager')
  );
$$;

-- ============================================================
-- 039_profiles_role_check_lead_stager.sql
-- ============================================================
-- Backfilled into the repo from the live DB (applied via MCP as
-- 039_profiles_role_check_lead_stager). Written idempotently so a clean
-- `supabase db reset` rebuilds the live schema. Repo docs only.

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role = any (array['admin'::text, 'stager'::text, 'lead_stager'::text]));

-- ============================================================
-- 040_activity_log.sql
-- ============================================================
-- Backfilled into the repo from the live DB (applied via MCP as
-- 040_activity_log). Written idempotently so a clean
-- `supabase db reset` rebuilds the live schema. Repo docs only.

-- Append-only audit feed surfaced in the admin Activity center.
-- Each row snapshots actor + stage metadata at write time so deletes
-- don't blank out the history.
create table if not exists public.activity_log (
  id uuid primary key default gen_random_uuid(),
  kind text not null,                                  -- 'stage_status_change' | 'stage_created' | 'stage_deleted' | 'photo_added' | 'payment_recorded'
  actor_id uuid references auth.users(id) on delete set null,
  actor_name text,                                     -- snapshot for display
  actor_email text,                                    -- snapshot for display
  stage_id uuid references public.stages(id) on delete set null,
  stage_address text,                                  -- snapshot
  details jsonb not null default '{}'::jsonb,          -- kind-specific extras
  created_at timestamptz not null default now()
);

create index if not exists activity_log_created_idx
  on public.activity_log(created_at desc);
create index if not exists activity_log_stage_id_idx
  on public.activity_log(stage_id);

alter table public.activity_log enable row level security;

-- Internal-RW only; portal clients should never see this feed.
drop policy if exists activity_log_internal_all on public.activity_log;
create policy activity_log_internal_all on public.activity_log
  for all to authenticated
  using (public.is_internal_user())
  with check (public.is_internal_user());

-- ============================================================
-- 041_stage_photo_primary.sql
-- ============================================================
-- Backfilled into the repo from the live DB (applied via MCP as
-- 041_stage_photo_primary). Written idempotently so a clean
-- `supabase db reset` rebuilds the live schema. Repo docs only.

-- Optional admin-picked main photo per stage. When set, the cached
-- stages.first_photo_storage_path uses it; otherwise the trigger falls
-- back to the earliest photo by created_at (legacy behavior).
alter table public.stage_photos
  add column if not exists is_primary boolean not null default false;

-- Only one primary per stage.
create unique index if not exists stage_photos_primary_unique
  on public.stage_photos(stage_id)
  where is_primary;

-- Updated refresher: prefer is_primary, fall back to earliest.
create or replace function public.refresh_stage_first_photo(p_stage_id uuid)
returns void
language plpgsql as $$
declare
  next_path text;
begin
  select storage_path into next_path
    from public.stage_photos
    where stage_id = p_stage_id and is_primary = true
    limit 1;
  if next_path is null then
    select storage_path into next_path
      from public.stage_photos
      where stage_id = p_stage_id
      order by created_at asc
      limit 1;
  end if;
  update public.stages
    set first_photo_storage_path = next_path
    where id = p_stage_id;
end;
$$;

-- ============================================================
-- 042_stager_availability.sql
-- ============================================================
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

-- ============================================================
-- 043_stager_weekly_availability.sql
-- ============================================================
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

-- ============================================================
-- 044_extension_acceptance_stamp.sql
-- ============================================================
-- Backfilled into the repo from the live DB (applied via MCP as
-- 044_extension_acceptance_stamp). Written idempotently so a clean
-- `supabase db reset` rebuilds the live schema. Repo docs only.

-- Lightweight acceptance record for client-confirmed extensions: who
-- tapped confirm, when, and a basic audit trail (IP + user agent). The
-- one-tap confirmation IS the agreement; this stamps it.
alter table public.stage_extensions
  add column if not exists accepted_at timestamptz,
  add column if not exists accepted_by text,
  add column if not exists accepted_ip text,
  add column if not exists accepted_user_agent text;

-- ============================================================
-- 045_stage_task_counts_view.sql
-- ============================================================
-- Backfilled into the repo from the live DB (applied via MCP as
-- 045_stage_task_counts_view). Written idempotently so a clean
-- `supabase db reset` rebuilds the live schema. Repo docs only.

-- Per-stage task totals so the board/groups pages can fetch ~801 count
-- rows instead of scanning the entire (thousands-of-rows) stage_tasks
-- table and aggregating in app code on every render.
create or replace view public.stage_task_counts as
select
  stage_id,
  count(*)::int as total,
  count(*) filter (where is_done)::int as done
from public.stage_tasks
group by stage_id;

-- ============================================================
-- 046_perf_advisor_indexes_and_rls_initplan.sql
-- ============================================================
-- Backfilled into the repo from the live DB (applied via MCP as
-- 046_perf_advisor_indexes_and_rls_initplan). Written idempotently so a
-- clean `supabase db reset` rebuilds the live schema. Repo docs only.
-- The `alter policy` statements assume the named policies already exist
-- from earlier migrations (033, 015, 016, 042/043) — true on an in-order
-- replay.

-- 1) Covering indexes for foreign keys flagged by the performance advisor.
create index if not exists activity_log_actor_id_idx on public.activity_log(actor_id);
create index if not exists stage_payments_created_by_idx on public.stage_payments(created_by);
create index if not exists stage_photos_uploaded_by_idx on public.stage_photos(uploaded_by);
create index if not exists stage_tasks_completed_by_idx on public.stage_tasks(completed_by);
create index if not exists stage_tasks_created_by_idx on public.stage_tasks(created_by);
create index if not exists stages_assigned_to_idx on public.stages(assigned_to);

-- 2) RLS init-plan fix: wrap auth.*() calls in (select ...) so they're
--    evaluated once per query (InitPlan) instead of once per row.
--    Identical access semantics — only the query plan changes.
alter policy clients_self_select on public.clients
  using (auth_user_id = (select auth.uid()));

alter policy contract_template_read on public.contract_template
  using ((select auth.role()) = 'authenticated'::text);

alter policy contract_template_admin_write on public.contract_template
  using (exists (
    select 1 from profiles
    where profiles.id = (select auth.uid()) and profiles.role = 'admin'::text
  ));

alter policy profiles_select_internal on public.profiles
  using (is_internal_user() or (id = (select auth.uid())));

alter policy profiles_update_self_or_admin on public.profiles
  using ((id = (select auth.uid())) or is_admin());

alter policy push_subs_owner_select on public.push_subscriptions
  using ((select auth.uid()) = user_id);
alter policy push_subs_owner_update on public.push_subscriptions
  using ((select auth.uid()) = user_id);
alter policy push_subs_owner_delete on public.push_subscriptions
  using ((select auth.uid()) = user_id);
alter policy push_subs_owner_insert on public.push_subscriptions
  with check ((select auth.uid()) = user_id);

alter policy "own delete availability" on public.stager_availability
  using (stager_id = (select auth.uid()));
alter policy "own insert availability" on public.stager_availability
  with check ((stager_id = (select auth.uid())) and is_internal_user());
alter policy "own update availability" on public.stager_availability
  using (stager_id = (select auth.uid()))
  with check (stager_id = (select auth.uid()));

alter policy "own delete weekly availability" on public.stager_weekly_availability
  using (stager_id = (select auth.uid()));
alter policy "own insert weekly availability" on public.stager_weekly_availability
  with check ((stager_id = (select auth.uid())) and is_internal_user());

-- ============================================================
-- 047_vehicle_maintenance_tracker.sql
-- ============================================================
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

-- ============================================================
-- 048_time_entries.sql
-- ============================================================
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

-- ============================================================
-- 049_grant_is_admin_execute_authenticated.sql
-- ============================================================
-- Backfilled into the repo from the live DB (applied via MCP as
-- 049_grant_is_admin_execute_authenticated). Written idempotently so a
-- clean `supabase db reset` rebuilds the live schema. Repo docs only.

-- time_entries_admin_all RLS calls is_admin() standalone, so Postgres must
-- evaluate it for every caller (including non-admins) on insert/select.
-- is_admin() is SECURITY DEFINER and only checks the caller's own role, so
-- granting EXECUTE to authenticated is safe and matches is_internal_user().
grant execute on function public.is_admin() to authenticated;

-- ============================================================
-- 050_time_entries_edited_flag.sql
-- ============================================================
-- Backfilled into the repo from the live DB (applied via MCP as
-- 050_time_entries_edited_flag). Written idempotently so a clean
-- `supabase db reset` rebuilds the live schema. Repo docs only.

-- Marks an entry that was manually added or had its times edited (vs a
-- plain clock-in/out), so it can be tagged in the UI.
alter table public.time_entries
  add column if not exists edited boolean not null default false;

-- ============================================================
-- 051_stage_photos_media_type_video.sql
-- ============================================================
-- Support video uploads alongside photos in the stage media grid.
-- (Applied to the live DB via MCP as 051_stage_photos_media_type_video;
--  written idempotently so it's safe to re-run.)

-- 1) Tag each media row as image or video (existing rows default to image).
alter table public.stage_photos
  add column if not exists media_type text not null default 'image';

alter table public.stage_photos
  drop constraint if exists stage_photos_media_type_check;
alter table public.stage_photos
  add constraint stage_photos_media_type_check
  check (media_type in ('image', 'video'));

-- 2) Card thumbnails (dashboard / board / groups) come from the cached
--    first_photo_storage_path and are served through Supabase image
--    transforms, which only work on images. Make the first-photo picker
--    ignore videos so a video uploaded first never becomes a broken
--    card thumbnail.
create or replace function public.refresh_stage_first_photo(p_stage_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  next_path text;
begin
  select storage_path
    into next_path
    from public.stage_photos
    where stage_id = p_stage_id
      and media_type = 'image'
    order by created_at asc
    limit 1;
  update public.stages
    set first_photo_storage_path = next_path
    where id = p_stage_id;
end;
$$;

-- 3) Allow video-sized uploads to this bucket. The effective cap is the
--    lower of this and the project-wide storage upload limit (Dashboard →
--    Storage → Settings), so that global limit must be >= this to matter.
update storage.buckets
  set file_size_limit = 209715200  -- 200 MB
  where id = 'stage-photos';

-- ============================================================
-- 052_tighten_stage_photos_bucket_rls.sql
-- ============================================================
-- The stage-photos bucket policies gated only on auth.role()='authenticated',
-- which includes portal CLIENTS (real auth users with no profiles row). Now
-- that videos upload directly from the browser to this bucket, those policies
-- are the real write boundary — so scope all raw bucket access to internal
-- team members (admin / stager / lead_stager). Clients never touch the bucket
-- directly; they only ever receive server-minted signed URLs, which bypass RLS.
-- (Applied to the live DB via MCP as 052; idempotent.)

drop policy if exists "stage_photos_read" on storage.objects;
create policy "stage_photos_read" on storage.objects
  for select using (
    bucket_id = 'stage-photos' and public.is_internal_user()
  );

drop policy if exists "stage_photos_write" on storage.objects;
create policy "stage_photos_write" on storage.objects
  for insert with check (
    bucket_id = 'stage-photos' and public.is_internal_user()
  );

drop policy if exists "stage_photos_delete" on storage.objects;
create policy "stage_photos_delete" on storage.objects
  for delete using (
    bucket_id = 'stage-photos' and public.is_internal_user()
  );

-- ============================================================
-- 053_stage_custom_line_items.sql
-- ============================================================
-- Custom pricing line items (each a free-form description + price) that
-- flow onto the estimate, contract, and invoice for a stage/estimate.
-- (Applied to the live DB via MCP as 053; idempotent.)
alter table public.stages
  add column if not exists line_items jsonb not null default '[]'::jsonb;

-- ============================================================
-- 054_estimate_public_line_items.sql
-- ============================================================
-- The public estimate page reads escrow / travel_fee / line_items, but the
-- estimate_public view never exposed them — so custom line items didn't show
-- and the displayed total was inflated by escrow + travel. Add the three
-- columns. Drop-then-create (not CREATE OR REPLACE) so this is re-runnable
-- regardless of the view's current column set; re-grants afterward since a
-- drop clears grants.
drop view if exists public.estimate_public;
create view public.estimate_public as
  select
    s.id,
    s.address,
    s.amount,
    s.stage_date,
    s.destage_date,
    s.package_key,
    s.add_ons,
    s.discount,
    s.status,
    s.estimate_token,
    s.estimate_accepted_at,
    s.estimate_declined_at,
    c.name as client_name,
    s.escrow,
    s.travel_fee,
    s.line_items
  from stages s
  left join clients c on c.id = s.client_id;

-- Re-grant (the drop above cleared it) + preserve the security_invoker
-- setting from migration 016.
grant select on public.estimate_public to anon, authenticated;
alter view public.estimate_public set (security_invoker = on);

-- ============================================================
-- 055_stage_photographer_at.sql
-- ============================================================
-- Photographer arrival deadline for a stage — the staging work must be
-- finished before this moment. Admins set it; all team members see it
-- (with a countdown) on the stage page.
-- (Applied to the live DB via MCP as 055; idempotent.)
alter table public.stages
  add column if not exists photographer_at timestamptz;

-- ============================================================
-- 056_payment_reminders.sql
-- ============================================================
-- Automated unpaid-invoice email reminders (stage invoices + extension
-- invoices): first reminder 5 days after the invoice email went out,
-- then every 3 days while unpaid.
-- (Applied to the live DB via MCP as 056; idempotent.)

-- Client-level opt-out — escrow payers don't need nagging.
alter table public.clients
  add column if not exists payment_reminders boolean not null default true;

-- Reminder bookkeeping so the cron knows when each invoice was last
-- nagged (and how many times).
alter table public.stages
  add column if not exists invoice_reminder_last_at timestamptz,
  add column if not exists invoice_reminder_count integer not null default 0;

alter table public.stage_extensions
  add column if not exists reminder_last_at timestamptz,
  add column if not exists reminder_count integer not null default 0;

-- ============================================================
-- 057_stage_contingency_removal.sql
-- ============================================================
-- Admin-entered date when the buyer's contingencies are removed on a
-- stage's sale — surfaced on the stage page and the dashboard's
-- "Contingency removals" section.
ALTER TABLE stages
  ADD COLUMN IF NOT EXISTS contingency_removal_date date;

-- ============================================================
-- 058_stage_unsigned_alert.sql
-- ============================================================
-- One-shot stamp so the day-before "agreement not signed" admin alert
-- never re-sends for the same stage.
ALTER TABLE stages
  ADD COLUMN IF NOT EXISTS unsigned_alert_sent_at timestamptz;

-- ============================================================
-- 059_profiles_no_default_team_role.sql
-- ============================================================
-- A portal magic link created an auth user whose trigger-generated
-- profile defaulted to role 'stager' — a CLIENT landed in the staff
-- app with stager access. Two-part fix:
--
-- 1) profiles.role: nullable, no default. A profile without an
--    explicitly granted role has NO team access (the app layout and
--    is_internal_user() both require a team role).
ALTER TABLE profiles ALTER COLUMN role DROP NOT NULL;
ALTER TABLE profiles ALTER COLUMN role DROP DEFAULT;

-- 2) Only create profiles for invited team members. Employee invites
--    carry full_name in the user metadata; portal-created client
--    users don't, so they get no profiles row at all.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
begin
  if new.raw_user_meta_data ? 'full_name' then
    insert into public.profiles (id, email, full_name)
    values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name',''));
  end if;
  return new;
end; $$;

-- ============================================================
-- 060_stage_bill_to.sql
-- ============================================================
-- Per-stage billing entity (e.g. the LLC a flipper buys under) —
-- printed as the invoice's Bill To name with the client as c/o.
ALTER TABLE stages ADD COLUMN IF NOT EXISTS bill_to text;

-- ============================================================
-- 061_stage_fees.sql
-- ============================================================
-- Extra charges reported by the crew on arrival (no lockbox key, house
-- inaccessible, house not ready). Each report becomes a fee invoice
-- that an admin approves before it's emailed to the client.
CREATE TABLE IF NOT EXISTS stage_fees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id uuid NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  reasons text[] NOT NULL,
  note text,
  amount numeric(10,2) NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'paid', 'dismissed')),
  reported_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  reported_by_name text,
  reported_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  approved_at timestamptz,
  invoice_number text,
  pdf_url text,
  sent_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stage_fees_stage_id_idx ON stage_fees(stage_id);
CREATE INDEX IF NOT EXISTS stage_fees_status_idx ON stage_fees(status);
ALTER TABLE stage_fees ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "stage_fees internal" ON stage_fees;
CREATE POLICY "stage_fees internal" ON stage_fees
  FOR ALL USING (is_internal_user()) WITH CHECK (is_internal_user());

-- ============================================================
-- 062_stage_agreement_fee_initials.sql
-- ============================================================
-- True once an agreement envelope carrying the initialed "Additional
-- Fees" block has been sent for this stage. Fee invoices/emails only
-- cite "initialed by client" when this is set AND the agreement was
-- signed; older agreements predate the clause.
ALTER TABLE stages ADD COLUMN IF NOT EXISTS agreement_fee_initials boolean NOT NULL DEFAULT false;

-- ============================================================
-- 063_stage_square_invoice.sql
-- ============================================================
-- Traceability + idempotency for the one-time Square Invoicing import.
-- Each stage created from a Square invoice records its originating invoice
-- number, so the importer can skip invoices it has already loaded on re-run
-- and staff can trace a project back to its Square invoice.
alter table public.stages
  add column if not exists square_invoice_number text;

-- Partial unique index: at most one stage per Square invoice number, but
-- unlimited NULLs for stages created inside the app.
create unique index if not exists stages_square_invoice_number_key
  on public.stages(square_invoice_number)
  where square_invoice_number is not null;

-- ============================================================
-- 064_revive_contract_template.sql
-- ============================================================
-- Import Revive Design Collective's staging contract into the editable
-- template (intro + numbered terms), replacing the generic placeholder
-- text from migration 006.
--
-- The "Additional Fees (please initial)" section and the client initials
-- box are rendered separately by contract-pdf.ts (ARRIVAL_FEE_CLAUSE) and
-- are intentionally left untouched.
update public.contract_template
set
  company_name = 'Revive Design Collective',
  intro = 'The following rooms will be staged: Living Room, Dining Room, Kitchen, Primary Bedroom, and Bathrooms. In addition to what is outlined above, rooms will include artwork, mirrors, centerpieces, plants, throw pillows, and room accessories.',
  terms = jsonb_build_array(
    jsonb_build_object('title', 'Staging Fee & Term', 'body', 'The staging fee is a flat fee, determined at the time of the agreement. It includes two months of staging, commencing on the date of install. The total fee is due upon installation of furnishings. Additional 30-day extensions are available for 50% of the original staging fee ({{extension_amount}}).'),
    jsonb_build_object('title', 'Payment', 'body', 'Payment is due upon completion of staging — on the day the staging is installed, not on any later invoice date. Please make checks payable to Revive Design Collective — Revive Design Co., 220 Sandburg Dr, Sacramento, CA 95819. Zelle: 530-251-3898 (Williams Real Estate Services).'),
    jsonb_build_object('title', 'De-Staging', 'body', 'Furnishings will be left in place until contingencies are removed, the realtor/client approves removal, or the agreement has expired. A 72-hour notice is required for de-staging the home.'),
    jsonb_build_object('title', 'Furnishing Selection', 'body', 'Client agrees the selection of furnishings is at the sole discretion of the stager.'),
    jsonb_build_object('title', 'Ownership of Furnishings', 'body', 'Client agrees that the furnishings are owned and leased by Revive Design Collective for display purposes only. While on the property, furnishings are to remain staged and are not to be used in any other fashion.'),
    jsonb_build_object('title', 'Care of Furnishings', 'body', 'Client agrees to exercise all due care in keeping, caring for, and preserving the furnishings. Cleaning fee starts at $600.'),
    jsonb_build_object('title', 'Loss or Damage', 'body', 'Client shall remain responsible for all loss or damage to the furnishings while they are on the property, up to and including actual replacement value for each missing or damaged item.'),
    jsonb_build_object('title', 'Publicity', 'body', 'Client agrees that photographs from the listing may be used for publicity on Revive Design Collective social media sites, website, and other marketing materials.'),
    jsonb_build_object('title', 'No Pets', 'body', 'No pets. For occupied staging, a cleaning fee will be charged if the furniture is returned with pet hair, dirt, or any stains. Please cover all staging furniture with linens.'),
    jsonb_build_object('title', 'Cancellation', 'body', 'We book 2-3 weeks in advance and your stage is part of a chain of events. If you decide to cancel, there will be a $1,000 fee.'),
    jsonb_build_object('title', 'Home Readiness', 'body', 'The home must be clean prior to staging.'),
    jsonb_build_object('title', 'Property Access', 'body', 'Only Revive Design Collective is allowed on the property during staging and de-staging. The presence of contractors slows down the process and workflow of our team.'),
    jsonb_build_object('title', 'Lockbox & Hours', 'body', 'Due to real estate timelines, a contractor lockbox is required on site for the move-in and move-out. We are unable to meet realtors at the property at a specific time. Please note that we start as early as 7am and do not work past 1pm.')
  ),
  updated_at = now()
where id = 1;
-- Migration 006 always seeds row id=1 first, so the UPDATE above is
-- sufficient for both fresh and existing databases.

-- ============================================================
-- 066_seller_handoff.sql
-- ============================================================
-- Seller handoff: an agent who doesn't want responsibility for a stage
-- can hand it to the homeowner/seller. The agent gets an email with a
-- link to a public form; they enter the seller's name + email, and the
-- app sends a FRESH agreement to the seller. From then on the seller
-- signs and pays — the agent stays on the stage as the referring
-- contact but is off the paperwork.
--
--   handoff_token           — public form link token (moved to
--                             handoff_token_consumed on submit so the
--                             form can still render its "done" state)
--   handoff_token_consumed  — the spent token
--   handoff_completed_at    — when the agent handed it off
--   homeowner_name/email    — the seller; recipient override for the
--                             signature + invoice
--
-- Written idempotently: the homeowner_* columns may already exist from
-- the earlier (reverted) intake migration 065.
alter table public.stages
  add column if not exists handoff_token text,
  add column if not exists handoff_token_consumed text,
  add column if not exists handoff_completed_at timestamptz,
  add column if not exists homeowner_name text,
  add column if not exists homeowner_email text;

create unique index if not exists stages_handoff_token_uniq
  on public.stages(handoff_token)
  where handoff_token is not null;

create unique index if not exists stages_handoff_token_consumed_uniq
  on public.stages(handoff_token_consumed)
  where handoff_token_consumed is not null;

-- ============================================================
-- 067_calendar_events.sql
-- ============================================================
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

-- ============================================================
-- 068_stage_staged_rooms.sql
-- ============================================================
-- Which rooms/areas this stage covers. Picked as checkboxes on the New
-- Stage form (and editable on the stage page); stored as a jsonb array
-- of keys from STAGED_ROOMS in src/lib/staged-rooms.ts.
alter table public.stages
  add column if not exists staged_rooms jsonb not null default '[]'::jsonb;

-- ============================================================
-- 069_contract_terms_verbatim.sql
-- ============================================================
-- Replace the agreement's Terms with Revive's authoritative wording: the
-- three money clauses (fee/extensions, payment, de-staging) followed by
-- the 10 numbered addendums exactly as they appear in the signed
-- contract. Supersedes the lightly-reworded set from migration 064.
update public.contract_template
set terms = jsonb_build_array(
    jsonb_build_object('title', 'Staging Fee & Term', 'body', 'The staging fee is a flat fee, determined at the time of the agreement. It includes two months of staging, commencing on the date of install. The total fee is due upon installation of furnishings. Additional 30-day extensions are available for 50% of the original staging fee ({{extension_amount}}).'),
    jsonb_build_object('title', 'Payment', 'body', 'Payment is due upon completion of staging — on the day the staging is installed, not on any later invoice date. Please make checks payable to: Revive Design Collective. Zelle: 530-251-3898 (Williams Real Estate Services).'),
    jsonb_build_object('title', 'De-Staging', 'body', 'Furnishings will be left in place until contingencies are removed, the realtor/client approves removal, or the agreement has expired. A 72-hour notice is required for de-staging the home.'),
    jsonb_build_object('title', 'Furnishing Selection', 'body', 'Client agrees the selection of furnishings is at the sole discretion of the stager.'),
    jsonb_build_object('title', 'Ownership of Furnishings', 'body', 'Client agrees that the furnishings are owned and leased by Revive Design Collective for display purposes only. While on the property, furnishings are to remain staged and are not to be used in any other fashion.'),
    jsonb_build_object('title', 'Care of Furnishings', 'body', 'Client agrees to exercise all due care in keeping, caring for, and preserving the furnishings. Cleaning fee starts at $600.'),
    jsonb_build_object('title', 'Loss or Damage', 'body', 'Client shall remain responsible for all loss or damages to the furnishings while they are on the property; up to and including actual replacement value for each missing or damaged item.'),
    jsonb_build_object('title', 'Publicity', 'body', 'Client agrees that photographs from the listing may be used for publicity on Revive Design Collective social media sites, website, and other marketing materials.'),
    jsonb_build_object('title', 'No Pets', 'body', 'NO PETS. Occupied staging — a cleaning fee will be charged if the furniture is returned with pet hair, dirt, or any stains. Please cover all staging furniture with linens.'),
    jsonb_build_object('title', 'Cancellation', 'body', 'Cancellation fee — please note that we book 2-3 weeks in advance and your stage is part of a chain of events; if you decide to cancel, there will be a $1,000 fee.'),
    jsonb_build_object('title', 'Home Readiness', 'body', 'Home must be clean prior to staging.'),
    jsonb_build_object('title', 'Property Access', 'body', 'Only Revive Design Co is allowed on the property during staging and de-staging. The presence of contractors slows down the process and workflow of our team.'),
    jsonb_build_object('title', 'Lockbox & Hours', 'body', 'We work hard to provide staging for a number of clients in the same timeframe. Due to real estate timelines, a contractor lockbox is required to be on site for the move in and the move out. We are unable to meet realtors at the property at a specific time. Please note that we start as early as 7am and do not work past 1pm.')
  ),
  updated_at = now()
where id = 1;

-- ============================================================
-- 070_contract_template_final.sql
-- ============================================================
-- One-shot: bring contract_template fully up to date — company name,
-- intro, and the final Terms (3 money clauses + Revive's 10 addendums
-- verbatim). Supersedes 064 and 069, so running this alone is enough on
-- a database that still has the placeholder terms from 006.
--
-- The intro no longer hardcodes a room list: the rooms now come from the
-- 'Rooms included' checkboxes on the stage form and print as the scope
-- of work, so a fixed list here would contradict them.
update public.contract_template
set company_name = 'Revive Design Collective',
    intro = 'In addition to the rooms staged, each room includes artwork, mirrors, centerpieces, plants, throw pillows, and room accessories.',
    terms = jsonb_build_array(
    jsonb_build_object('title', 'Staging Fee & Term', 'body', 'The staging fee is a flat fee, determined at the time of the agreement. It includes two months of staging, commencing on the date of install. The total fee is due upon installation of furnishings. Additional 30-day extensions are available for 50% of the original staging fee ({{extension_amount}}).'),
    jsonb_build_object('title', 'Payment', 'body', 'Payment is due upon completion of staging — on the day the staging is installed, not on any later invoice date. Please make checks payable to: Revive Design Collective. Zelle: 530-251-3898 (Williams Real Estate Services).'),
    jsonb_build_object('title', 'De-Staging', 'body', 'Furnishings will be left in place until contingencies are removed, the realtor/client approves removal, or the agreement has expired. A 72-hour notice is required for de-staging the home.'),
    jsonb_build_object('title', 'Furnishing Selection', 'body', 'Client agrees the selection of furnishings is at the sole discretion of the stager.'),
    jsonb_build_object('title', 'Ownership of Furnishings', 'body', 'Client agrees that the furnishings are owned and leased by Revive Design Collective for display purposes only. While on the property, furnishings are to remain staged and are not to be used in any other fashion.'),
    jsonb_build_object('title', 'Care of Furnishings', 'body', 'Client agrees to exercise all due care in keeping, caring for, and preserving the furnishings. Cleaning fee starts at $600.'),
    jsonb_build_object('title', 'Loss or Damage', 'body', 'Client shall remain responsible for all loss or damages to the furnishings while they are on the property; up to and including actual replacement value for each missing or damaged item.'),
    jsonb_build_object('title', 'Publicity', 'body', 'Client agrees that photographs from the listing may be used for publicity on Revive Design Collective social media sites, website, and other marketing materials.'),
    jsonb_build_object('title', 'No Pets', 'body', 'NO PETS. Occupied staging — a cleaning fee will be charged if the furniture is returned with pet hair, dirt, or any stains. Please cover all staging furniture with linens.'),
    jsonb_build_object('title', 'Cancellation', 'body', 'Cancellation fee — please note that we book 2-3 weeks in advance and your stage is part of a chain of events; if you decide to cancel, there will be a $1,000 fee.'),
    jsonb_build_object('title', 'Home Readiness', 'body', 'Home must be clean prior to staging.'),
    jsonb_build_object('title', 'Property Access', 'body', 'Only Revive Design Co is allowed on the property during staging and de-staging. The presence of contractors slows down the process and workflow of our team.'),
    jsonb_build_object('title', 'Lockbox & Hours', 'body', 'We work hard to provide staging for a number of clients in the same timeframe. Due to real estate timelines, a contractor lockbox is required to be on site for the move in and the move out. We are unable to meet realtors at the property at a specific time. Please note that we start as early as 7am and do not work past 1pm.')
  ),
  updated_at = now()
where id = 1;

-- ============================================================
-- 071_stage_agent_note.sql
-- ============================================================
-- A short note written on the stage form that prints in the signer-choice
-- email sent to the agent. Kept separate from stages.notes, which is the
-- team's internal note and must never leave the app.
alter table public.stages
  add column if not exists agent_note text;


-- ---------------------------------------------------------------
-- 072_payment_address.sql
-- ---------------------------------------------------------------
-- Add the remit-to address to the contract's Payment term. Targeted at
-- that one clause (matched by title) rather than rewriting the whole
-- terms array, so any edits made through the template editor survive.
update public.contract_template
set terms = (
  select jsonb_agg(
    case
      when t->>'title' = 'Payment' then jsonb_build_object(
        'title', 'Payment',
        'body', 'Payment is due upon completion of staging — on the day the staging is installed, not on any later invoice date. Please make checks payable to: Revive Design Collective, 220 Sandburg Drive, Sacramento, CA 95819. Zelle: 530-251-3898 (Williams Real Estate Services).'
      )
      else t
    end
    order by ord
  )
  from jsonb_array_elements(terms) with ordinality as e(t, ord)
)
where id = 1
  and terms @> '[{"title": "Payment"}]'::jsonb;

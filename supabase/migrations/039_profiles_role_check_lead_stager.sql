-- Backfilled into the repo from the live DB (applied via MCP as
-- 039_profiles_role_check_lead_stager). Written idempotently so a clean
-- `supabase db reset` rebuilds the live schema. Repo docs only.

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role = any (array['admin'::text, 'stager'::text, 'lead_stager'::text]));

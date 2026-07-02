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

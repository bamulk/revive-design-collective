-- Backfilled into the repo from the live DB (applied via MCP as
-- 049_grant_is_admin_execute_authenticated). Written idempotently so a
-- clean `supabase db reset` rebuilds the live schema. Repo docs only.

-- time_entries_admin_all RLS calls is_admin() standalone, so Postgres must
-- evaluate it for every caller (including non-admins) on insert/select.
-- is_admin() is SECURITY DEFINER and only checks the caller's own role, so
-- granting EXECUTE to authenticated is safe and matches is_internal_user().
grant execute on function public.is_admin() to authenticated;

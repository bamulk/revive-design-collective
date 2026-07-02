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

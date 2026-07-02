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

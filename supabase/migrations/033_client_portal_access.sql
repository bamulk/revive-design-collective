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

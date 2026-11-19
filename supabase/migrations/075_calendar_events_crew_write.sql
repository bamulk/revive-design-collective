-- Let the whole team add calendar entries (not just admins). Anyone on
-- the team can add one; they can change or remove only their own;
-- admins can change or remove any. Reading is unchanged (whole team).
drop policy if exists calendar_events_admin_write on public.calendar_events;

drop policy if exists calendar_events_insert on public.calendar_events;
create policy calendar_events_insert on public.calendar_events
  for insert to authenticated
  with check (public.is_internal_user() and created_by = auth.uid());

drop policy if exists calendar_events_update on public.calendar_events;
create policy calendar_events_update on public.calendar_events
  for update to authenticated
  using (public.is_admin() or (public.is_internal_user() and created_by = auth.uid()))
  with check (public.is_admin() or (public.is_internal_user() and created_by = auth.uid()));

drop policy if exists calendar_events_delete on public.calendar_events;
create policy calendar_events_delete on public.calendar_events
  for delete to authenticated
  using (public.is_admin() or (public.is_internal_user() and created_by = auth.uid()));

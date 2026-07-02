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

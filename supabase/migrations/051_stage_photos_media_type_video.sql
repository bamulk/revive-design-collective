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

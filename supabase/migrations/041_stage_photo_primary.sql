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

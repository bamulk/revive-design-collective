-- Backfilled into the repo from the live DB (applied via MCP as
-- 036_stage_length_days). Written idempotently so a clean
-- `supabase db reset` rebuilds the live schema. Repo docs only.

-- Allow stages to opt into an extended 90-day rental period. Default
-- 60 matches the legacy contract length so existing data is unchanged.
-- Check constraint keeps the column to the two values we support; if
-- more lengths are needed later, drop and replace this.
alter table public.stages
  add column if not exists stage_length_days int not null default 60;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'stages_stage_length_days_check'
  ) then
    alter table public.stages
      add constraint stages_stage_length_days_check
      check (stage_length_days in (60, 90));
  end if;
end$$;

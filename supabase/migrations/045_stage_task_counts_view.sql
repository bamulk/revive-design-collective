-- Backfilled into the repo from the live DB (applied via MCP as
-- 045_stage_task_counts_view). Written idempotently so a clean
-- `supabase db reset` rebuilds the live schema. Repo docs only.

-- Per-stage task totals so the board/groups pages can fetch ~801 count
-- rows instead of scanning the entire (thousands-of-rows) stage_tasks
-- table and aggregating in app code on every render.
create or replace view public.stage_task_counts as
select
  stage_id,
  count(*)::int as total,
  count(*) filter (where is_done)::int as done
from public.stage_tasks
group by stage_id;

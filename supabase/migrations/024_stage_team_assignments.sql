-- Team assignments for the Plan page.
--
-- The admin uses /plan to look ahead at the next few days of stages
-- and destages and assign each job to one of three teams. After picking
-- a team, the admin chooses which stagers from the roster are on that
-- team for that job.
--
-- Modeled per-job (not as a separate teams table) because team
-- membership can shift day-to-day depending on who's available.
ALTER TABLE public.stages
  ADD COLUMN IF NOT EXISTS team text,
  ADD COLUMN IF NOT EXISTS assigned_stager_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

ALTER TABLE public.stages
  DROP CONSTRAINT IF EXISTS stages_team_check;
ALTER TABLE public.stages
  ADD CONSTRAINT stages_team_check
  CHECK (team IS NULL OR team = ANY (ARRAY['grey'::text, 'white'::text, 'little'::text]));

-- Fast lookups for the Plan page: "all jobs with stage_date or
-- destage_date in the next N days".
CREATE INDEX IF NOT EXISTS stages_stage_date_idx
  ON public.stages (stage_date)
  WHERE stage_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS stages_destage_date_idx
  ON public.stages (destage_date)
  WHERE destage_date IS NOT NULL;

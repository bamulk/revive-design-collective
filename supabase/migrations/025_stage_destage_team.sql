-- Split team assignments between staging and destaging.
--
-- Migration 024 added a single (team, assigned_stager_ids) pair per
-- stage — but a house's staging crew and destaging crew are often
-- different teams. We keep the original columns as the *stage-day*
-- crew, and add destage_team / destage_stager_ids for the destage day.
ALTER TABLE public.stages
  ADD COLUMN IF NOT EXISTS destage_team text,
  ADD COLUMN IF NOT EXISTS destage_stager_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

ALTER TABLE public.stages
  DROP CONSTRAINT IF EXISTS stages_destage_team_check;
ALTER TABLE public.stages
  ADD CONSTRAINT stages_destage_team_check
  CHECK (destage_team IS NULL OR destage_team = ANY (ARRAY['grey'::text, 'white'::text, 'little'::text]));

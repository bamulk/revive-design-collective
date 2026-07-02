-- Indexes to speed up the hot query patterns observed in production:
--
--   stages: every list view (groups, board, calendar, dashboard
--     outstanding-invoices, today widget) sorts/filters on stage_date,
--     destage_date, or (status, stage_date) together.
--
--   stage_photos: "first photo per stage" lookups order by created_at,
--     which on ~5K rows was forcing a sequential scan.
CREATE INDEX IF NOT EXISTS stages_stage_date_idx
  ON public.stages (stage_date);

CREATE INDEX IF NOT EXISTS stages_status_stage_date_idx
  ON public.stages (status, stage_date);

CREATE INDEX IF NOT EXISTS stages_destage_date_idx
  ON public.stages (destage_date);

CREATE INDEX IF NOT EXISTS stage_photos_created_at_idx
  ON public.stage_photos (created_at);

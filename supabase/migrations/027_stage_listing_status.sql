-- Track Zillow listing status on each stage so the admin gets an
-- email the moment a staged property goes pending. Updated daily by
-- /api/cron/check-listing-status.
--
--   listing_status              — last status string from Zillow
--                                 (e.g. "FOR_SALE", "PENDING").
--   listing_status_checked_at   — last successful fetch.
--   listing_pending_notified_at — set when we email the admins about
--                                 a pending transition; prevents
--                                 re-notifying every day.
--   listing_monitor             — admin can opt a stage out of the
--                                 daily check (e.g. off-market jobs).
ALTER TABLE public.stages
  ADD COLUMN IF NOT EXISTS listing_status text,
  ADD COLUMN IF NOT EXISTS listing_status_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS listing_pending_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS listing_monitor boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS stages_listing_monitor_idx
  ON public.stages (status)
  WHERE listing_monitor = true
    AND listing_pending_notified_at IS NULL
    AND zillow_url IS NOT NULL;

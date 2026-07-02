-- Text-notification scaffolding.
-- - sms_notifications_enabled: per-admin opt-in (default ON)
-- - photo_reminder_sent_at: stamped when the "3-day photo nag"
--   fires so we don't spam admins every day after that.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS sms_notifications_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE stages
  ADD COLUMN IF NOT EXISTS photo_reminder_sent_at timestamp with time zone;

-- One-shot stamp so the day-before "agreement not signed" admin alert
-- never re-sends for the same stage.
ALTER TABLE stages
  ADD COLUMN IF NOT EXISTS unsigned_alert_sent_at timestamptz;

-- Staging extension flow:
--   1. Cron fires 10 days before destage_date, emails client.
--   2. Client clicks the link, lands on /x/{token}, chooses
--      Extend (bump destage_date 60 days, generate a 50% invoice)
--      or Destage (no change, admin gets notified).
ALTER TABLE public.stages
  ADD COLUMN IF NOT EXISTS extension_token text,
  ADD COLUMN IF NOT EXISTS extension_email_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS extension_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extension_invoice_pdf_url text,
  ADD COLUMN IF NOT EXISTS extension_invoice_amount numeric(10, 2),
  ADD COLUMN IF NOT EXISTS extension_invoice_paid_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS stages_extension_token_uniq
  ON public.stages (extension_token)
  WHERE extension_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS stages_destage_date_for_reminder_idx
  ON public.stages (destage_date)
  WHERE status = 'staged' AND extension_email_sent_at IS NULL;

-- Automated unpaid-invoice email reminders (stage invoices + extension
-- invoices): first reminder 5 days after the invoice email went out,
-- then every 3 days while unpaid.
-- (Applied to the live DB via MCP as 056; idempotent.)

-- Client-level opt-out — escrow payers don't need nagging.
alter table public.clients
  add column if not exists payment_reminders boolean not null default true;

-- Reminder bookkeeping so the cron knows when each invoice was last
-- nagged (and how many times).
alter table public.stages
  add column if not exists invoice_reminder_last_at timestamptz,
  add column if not exists invoice_reminder_count integer not null default 0;

alter table public.stage_extensions
  add column if not exists reminder_last_at timestamptz,
  add column if not exists reminder_count integer not null default 0;

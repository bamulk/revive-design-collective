-- Backfilled into the repo from the live DB (applied via MCP as
-- 037_secondary_recipient). Written idempotently so a clean
-- `supabase db reset` rebuilds the live schema. Repo docs only.

-- Optional second person on a stage / estimate. Used when the client
-- splits payment with the homeowner (or the homeowner pays directly).
-- Both names appear on the contract, both signatures are required,
-- and both addresses are CC'd on the invoice + estimate emails.
alter table public.stages
  add column if not exists secondary_recipient_name text,
  add column if not exists secondary_recipient_email text;

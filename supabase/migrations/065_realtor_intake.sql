-- Realtor-intake flow: a stage is created under a realtor/agent (the
-- client of record). The agent is emailed a link to a public form where
-- they enter the homeowner's name + email; the e-signature and (after
-- signing) the invoice then go to that homeowner, not the agent.
--
--   intake_token           — public form link token (moved to
--                            intake_token_consumed on submit so the
--                            form can render its "thanks" state)
--   intake_token_consumed  — the spent token
--   intake_completed_at    — when the realtor submitted the homeowner
--   homeowner_name/email   — recipient override for signature + invoice
alter table public.stages
  add column if not exists intake_token text,
  add column if not exists intake_token_consumed text,
  add column if not exists intake_completed_at timestamptz,
  add column if not exists homeowner_name text,
  add column if not exists homeowner_email text;

create unique index if not exists stages_intake_token_uniq
  on public.stages(intake_token)
  where intake_token is not null;

create unique index if not exists stages_intake_token_consumed_uniq
  on public.stages(intake_token_consumed)
  where intake_token_consumed is not null;

-- Seller handoff: an agent who doesn't want responsibility for a stage
-- can hand it to the homeowner/seller. The agent gets an email with a
-- link to a public form; they enter the seller's name + email, and the
-- app sends a FRESH agreement to the seller. From then on the seller
-- signs and pays — the agent stays on the stage as the referring
-- contact but is off the paperwork.
--
--   handoff_token           — public form link token (moved to
--                             handoff_token_consumed on submit so the
--                             form can still render its "done" state)
--   handoff_token_consumed  — the spent token
--   handoff_completed_at    — when the agent handed it off
--   homeowner_name/email    — the seller; recipient override for the
--                             signature + invoice
--
-- Written idempotently: the homeowner_* columns may already exist from
-- the earlier (reverted) intake migration 065.
alter table public.stages
  add column if not exists handoff_token text,
  add column if not exists handoff_token_consumed text,
  add column if not exists handoff_completed_at timestamptz,
  add column if not exists homeowner_name text,
  add column if not exists homeowner_email text;

create unique index if not exists stages_handoff_token_uniq
  on public.stages(handoff_token)
  where handoff_token is not null;

create unique index if not exists stages_handoff_token_consumed_uniq
  on public.stages(handoff_token_consumed)
  where handoff_token_consumed is not null;

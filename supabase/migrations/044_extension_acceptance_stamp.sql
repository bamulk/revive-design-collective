-- Backfilled into the repo from the live DB (applied via MCP as
-- 044_extension_acceptance_stamp). Written idempotently so a clean
-- `supabase db reset` rebuilds the live schema. Repo docs only.

-- Lightweight acceptance record for client-confirmed extensions: who
-- tapped confirm, when, and a basic audit trail (IP + user agent). The
-- one-tap confirmation IS the agreement; this stamps it.
alter table public.stage_extensions
  add column if not exists accepted_at timestamptz,
  add column if not exists accepted_by text,
  add column if not exists accepted_ip text,
  add column if not exists accepted_user_agent text;

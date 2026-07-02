-- Backfilled into the repo from the live DB (applied via MCP as
-- 034_plaid_integration). Written idempotently so a clean
-- `supabase db reset` rebuilds the live schema. Repo docs only.

-- One row per linked Plaid Item (bank connection). access_token is the
-- long-lived server credential — never expose to the browser.
create table if not exists public.plaid_items (
  id uuid primary key default gen_random_uuid(),
  item_id text not null unique,
  access_token text not null,
  institution_id text,
  institution_name text,
  -- Cursor for /transactions/sync — null means "fetch from beginning".
  cursor text,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

alter table public.plaid_items enable row level security;

-- Plaid items are internal-only. Service-role bypasses RLS for cron/
-- webhook writes; this just makes sure no client can ever see them.
drop policy if exists plaid_items_internal_all on public.plaid_items;
create policy plaid_items_internal_all on public.plaid_items
  for all to authenticated
  using (public.is_internal_user())
  with check (public.is_internal_user());

-- Extend expenses with the Plaid dedup key. UNIQUE so the same Plaid
-- transaction can't land twice on retries / cursor replays.
alter table public.expenses
  add column if not exists plaid_transaction_id text;
create unique index if not exists expenses_plaid_transaction_id_unique
  on public.expenses(plaid_transaction_id)
  where plaid_transaction_id is not null;

alter table public.expenses
  add column if not exists pending boolean not null default false;
alter table public.expenses
  add column if not exists plaid_account_id text;

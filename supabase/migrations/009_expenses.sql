-- Expense tracking. Income lives on stages (amount + paid_at); expenses
-- get their own table so we can record outflows from CSV imports,
-- manual entry, or future Plaid sync.
-- Run via Supabase SQL editor (or already applied via MCP for prod).

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  amount numeric(12, 2) not null,
  description text not null,
  category text,
  source text default 'manual',
  external_id text,
  created_at timestamptz not null default now()
);

-- Full UNIQUE constraint (not a partial index) so upsert's ON CONFLICT
-- can target it. Postgres treats NULLs as distinct, so manually-added
-- rows that have no external_id still coexist.
alter table public.expenses
  drop constraint if exists expenses_external_id_key;
alter table public.expenses
  add constraint expenses_external_id_key unique (external_id);

create index if not exists expenses_date_idx on public.expenses (date desc);

alter table public.expenses enable row level security;

drop policy if exists "expenses_all_authed" on public.expenses;
create policy "expenses_all_authed" on public.expenses
  for all using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

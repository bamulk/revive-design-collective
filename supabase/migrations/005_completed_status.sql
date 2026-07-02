-- Drop the old "invoiced" and "paid" statuses; collapse both into "completed".
-- Run this in your Supabase SQL editor (or already applied via MCP for prod).

alter table public.stages
  drop constraint if exists stages_status_check;

update public.stages set status = 'completed'
  where status in ('paid', 'invoiced');

alter table public.stages
  add constraint stages_status_check
  check (status in ('scheduled','staged','destaged','completed','cancelled'));

alter table public.stages
  alter column status set default 'scheduled';

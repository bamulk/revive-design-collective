-- Estimate workflow: a stage with status='estimate' is a pre-workflow
-- record. The client gets a public accept link; accepting flips status
-- to 'scheduled' and the regular workflow takes over.
-- Run via Supabase SQL editor (or already applied via MCP for prod).

alter table public.stages drop constraint if exists stages_status_check;
alter table public.stages
  add constraint stages_status_check
  check (status in ('estimate','scheduled','staged','destaged','completed','cancelled'));

alter table public.stages
  add column if not exists estimate_token text,
  add column if not exists estimate_sent_at timestamptz,
  add column if not exists estimate_accepted_at timestamptz,
  add column if not exists estimate_declined_at timestamptz;

create unique index if not exists stages_estimate_token_uniq
  on public.stages (estimate_token)
  where estimate_token is not null;

-- Anonymous-friendly view used by the public accept page.
create or replace view public.estimate_public as
  select
    s.id,
    s.address,
    s.amount,
    s.stage_date,
    s.destage_date,
    s.package_key,
    s.add_ons,
    s.discount,
    s.status,
    s.estimate_token,
    s.estimate_accepted_at,
    s.estimate_declined_at,
    c.name as client_name
  from public.stages s
  left join public.clients c on c.id = s.client_id;

grant select on public.estimate_public to anon, authenticated;

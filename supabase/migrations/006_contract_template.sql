-- Single-row table holding the editable parts of the staging agreement.
-- Run this in your Supabase SQL editor (or already applied via MCP for prod).

create table if not exists public.contract_template (
  id integer primary key default 1 check (id = 1),
  company_name text not null default 'Revive Design Collective',
  intro text,
  terms jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.contract_template (id, company_name, intro, terms)
values (
  1,
  'Revive Design Collective',
  null,
  jsonb_build_array(
    jsonb_build_object('title', 'Services',     'body', 'Stager will provide home staging services at the Property, including furniture and decor selection, placement, and removal on the destage date.'),
    jsonb_build_object('title', 'Fee',          'body', 'Client agrees to pay the total fee shown above. An invoice will be issued on the stage date. Payment is due within 14 days of the invoice date unless otherwise agreed in writing.'),
    jsonb_build_object('title', 'Access',       'body', 'Client will provide Stager reasonable access to the Property on the stage and destage dates. Delays caused by inaccessibility may incur rescheduling fees.'),
    jsonb_build_object('title', 'Care of Property', 'body', 'Stager will exercise reasonable care. Stager is not responsible for pre-existing conditions or damage caused by third parties.'),
    jsonb_build_object('title', 'Inventory',    'body', 'All furniture and decor brought to the Property remain the property of Stager and will be removed on the destage date. Client agrees not to move, sell, or otherwise disturb the inventory.'),
    jsonb_build_object('title', 'Cancellation', 'body', 'Cancellations requested less than 72 hours before the stage date may incur a charge of up to 50% of the total fee.'),
    jsonb_build_object('title', 'Entire Agreement', 'body', 'This document is the full agreement between the parties regarding these services.')
  )
)
on conflict (id) do nothing;

alter table public.contract_template enable row level security;

drop policy if exists "contract_template_read" on public.contract_template;
create policy "contract_template_read" on public.contract_template
  for select using (auth.role() = 'authenticated');

drop policy if exists "contract_template_admin_write" on public.contract_template;
create policy "contract_template_admin_write" on public.contract_template
  for update using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'
    )
  );

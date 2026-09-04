-- Standalone invoices: cleaning fees, furniture sales, split stage
-- billing, or anything else that isn't the one-invoice-per-stage model
-- baked into stages.*. Usually tied to a client, optionally to a stage,
-- and sometimes to neither (a one-off buyer). The Bill To block is
-- snapshotted onto the row so a later client edit never rewrites an
-- invoice that already went out.
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique,
  client_id uuid references public.clients(id) on delete set null,
  stage_id uuid references public.stages(id) on delete set null,
  bill_to_name text not null,
  bill_to_email text,
  bill_to_address text,
  -- Short description printed under the header, e.g. "Cleaning fee",
  -- "Furniture sale", "Staging — 50% deposit".
  title text not null,
  -- Optional "Re:" line, e.g. the property address.
  reference text,
  -- [{ description, qty, unit_price, amount }]
  line_items jsonb not null default '[]'::jsonb,
  discount numeric(12,2) not null default 0 check (discount >= 0),
  total numeric(12,2) not null default 0 check (total >= 0),
  invoice_date date not null default current_date,
  due_date date,
  payment_terms text,
  notes text,
  -- Append the standard staging terms (from the contract template)
  -- under the payment instructions. Off by default — a furniture sale
  -- doesn't need the no-pets clause.
  include_staging_terms boolean not null default false,
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'paid', 'void')),
  pdf_url text,
  pdf_generated_at timestamptz,
  sent_at timestamptz,
  paid_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists invoices_client_id_idx on public.invoices(client_id);
create index if not exists invoices_stage_id_idx on public.invoices(stage_id);
create index if not exists invoices_status_idx on public.invoices(status);
create index if not exists invoices_invoice_date_idx on public.invoices(invoice_date);

alter table public.invoices enable row level security;

drop policy if exists invoices_internal_all on public.invoices;
create policy invoices_internal_all on public.invoices
  for all to authenticated
  using (public.is_internal_user())
  with check (public.is_internal_user());

-- Portal clients can read their own invoices (same shape as
-- stage_payments_client_select).
drop policy if exists invoices_client_select on public.invoices;
create policy invoices_client_select on public.invoices
  for select to authenticated
  using (client_id is not null and client_id = public.current_client_id());

-- Payments ledger, mirroring stage_payments: N rows per invoice, each a
-- real receipt. The invoice's status/paid_at follow the ledger by
-- trigger so partial payments (split billing, deposits) work.
create table if not exists public.invoice_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  paid_at date not null,
  method text,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists invoice_payments_invoice_id_idx on public.invoice_payments(invoice_id);
create index if not exists invoice_payments_paid_at_idx on public.invoice_payments(paid_at);

alter table public.invoice_payments enable row level security;

drop policy if exists invoice_payments_internal_all on public.invoice_payments;
create policy invoice_payments_internal_all on public.invoice_payments
  for all to authenticated
  using (public.is_internal_user())
  with check (public.is_internal_user());

drop policy if exists invoice_payments_client_select on public.invoice_payments;
create policy invoice_payments_client_select on public.invoice_payments
  for select to authenticated
  using (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_payments.invoice_id
        and i.client_id is not null
        and i.client_id = public.current_client_id()
    )
  );

-- Paid when the ledger covers the total. Un-paying (a payment deleted
-- or the total raised) drops back to 'sent' if it was ever emailed,
-- else 'draft'. Void is never touched — voiding is an explicit choice.
create or replace function public.refresh_invoice_paid_status() returns trigger
language plpgsql as $$
declare
  v_invoice_id uuid;
  v_total_paid numeric;
  v_last_paid date;
  v_total numeric;
  v_status text;
  v_sent_at timestamptz;
begin
  v_invoice_id := coalesce(NEW.invoice_id, OLD.invoice_id);
  select coalesce(sum(amount), 0), max(paid_at)
    into v_total_paid, v_last_paid
    from public.invoice_payments where invoice_id = v_invoice_id;
  select total, status, sent_at into v_total, v_status, v_sent_at
    from public.invoices where id = v_invoice_id;
  if v_status = 'void' then
    return null;
  end if;
  if v_total is not null and v_total > 0 and v_total_paid >= v_total then
    update public.invoices
       set status = 'paid',
           paid_at = (v_last_paid::timestamp at time zone 'UTC'),
           updated_at = now()
     where id = v_invoice_id;
  else
    update public.invoices
       set status = case when v_sent_at is not null then 'sent' else 'draft' end,
           paid_at = null,
           updated_at = now()
     where id = v_invoice_id
       and status = 'paid';
  end if;
  return null;
end $$;

drop trigger if exists invoice_payments_refresh_paid on public.invoice_payments;
create trigger invoice_payments_refresh_paid
after insert or update or delete on public.invoice_payments
for each row execute function public.refresh_invoice_paid_status();

-- Re-evaluate when the total changes (an edit after a deposit landed).
create or replace function public.refresh_invoice_paid_on_total_change() returns trigger
language plpgsql as $$
declare
  v_total_paid numeric;
  v_last_paid date;
begin
  if NEW.total is distinct from OLD.total and NEW.status <> 'void' then
    select coalesce(sum(amount), 0), max(paid_at)
      into v_total_paid, v_last_paid
      from public.invoice_payments where invoice_id = NEW.id;
    if NEW.total > 0 and v_total_paid >= NEW.total then
      NEW.status := 'paid';
      NEW.paid_at := (v_last_paid::timestamp at time zone 'UTC');
    elsif NEW.status = 'paid' then
      NEW.status := case when NEW.sent_at is not null then 'sent' else 'draft' end;
      NEW.paid_at := null;
    end if;
  end if;
  NEW.updated_at := now();
  return NEW;
end $$;

drop trigger if exists invoices_refresh_paid_on_total_change on public.invoices;
create trigger invoices_refresh_paid_on_total_change
before update on public.invoices
for each row execute function public.refresh_invoice_paid_on_total_change();

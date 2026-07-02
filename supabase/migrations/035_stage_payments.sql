-- Backfilled into the repo from the live DB (applied via MCP as
-- 035_stage_payments). Written idempotently so a clean
-- `supabase db reset` rebuilds the live schema. Repo docs only.

-- Per-stage payments ledger. N rows per stage, each a real payment
-- event (amount + date + method + free-form note). stages.paid_at is
-- kept in sync by trigger so existing "is this paid?" queries stay
-- meaningful (it now means "fully paid on").
create table if not exists public.stage_payments (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references public.stages(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  paid_at date not null,
  method text,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists stage_payments_stage_id_idx on public.stage_payments(stage_id);
create index if not exists stage_payments_paid_at_idx on public.stage_payments(paid_at);

alter table public.stage_payments enable row level security;

-- Internal users can do everything; clients can SELECT payments tied
-- to their own stages.
drop policy if exists stage_payments_internal_all on public.stage_payments;
create policy stage_payments_internal_all on public.stage_payments
  for all to authenticated
  using (public.is_internal_user())
  with check (public.is_internal_user());
drop policy if exists stage_payments_client_select on public.stage_payments;
create policy stage_payments_client_select on public.stage_payments
  for select to authenticated
  using (
    exists (
      select 1 from public.stages s
      where s.id = stage_payments.stage_id
        and s.client_id = public.current_client_id()
    )
  );

-- Keep stages.paid_at in sync with the payments ledger. The stage is
-- "fully paid" when the sum of payments >= the stage amount; paid_at
-- becomes the most recent payment's date. Otherwise paid_at is null
-- (partial / unpaid).
create or replace function public.refresh_stage_paid_status() returns trigger
language plpgsql as $$
declare
  v_stage_id uuid;
  v_total numeric;
  v_last_paid date;
  v_amount numeric;
begin
  v_stage_id := coalesce(NEW.stage_id, OLD.stage_id);
  select coalesce(sum(amount), 0), max(paid_at)
    into v_total, v_last_paid
    from public.stage_payments where stage_id = v_stage_id;
  select amount into v_amount from public.stages where id = v_stage_id;
  if v_amount is not null and v_total >= v_amount then
    update public.stages
       set paid_at = (v_last_paid::timestamp at time zone 'UTC')
     where id = v_stage_id;
  else
    update public.stages set paid_at = null where id = v_stage_id;
  end if;
  return null;
end $$;

drop trigger if exists stage_payments_refresh_paid on public.stage_payments;
create trigger stage_payments_refresh_paid
after insert or update or delete on public.stage_payments
for each row execute function public.refresh_stage_paid_status();

-- If the stage's amount changes, re-evaluate paid status against the
-- existing payments. Otherwise raising the amount on a fully-paid
-- stage would leave paid_at incorrectly set.
create or replace function public.refresh_stage_paid_on_amount_change() returns trigger
language plpgsql as $$
declare
  v_total numeric;
  v_last_paid date;
begin
  if NEW.amount is distinct from OLD.amount then
    select coalesce(sum(amount), 0), max(paid_at)
      into v_total, v_last_paid
      from public.stage_payments where stage_id = NEW.id;
    if NEW.amount is not null and v_total >= NEW.amount then
      NEW.paid_at := (v_last_paid::timestamp at time zone 'UTC');
    else
      NEW.paid_at := null;
    end if;
  end if;
  return NEW;
end $$;

drop trigger if exists stages_refresh_paid_on_amount_change on public.stages;
create trigger stages_refresh_paid_on_amount_change
before update of amount on public.stages
for each row execute function public.refresh_stage_paid_on_amount_change();

-- Backfill: every stage that already has paid_at set + a positive
-- amount gets a single full-amount payment row in the ledger.
insert into public.stage_payments (stage_id, amount, paid_at, method, note)
select s.id, s.amount, s.paid_at::date, s.payment_method,
       'Backfilled from legacy paid_at'
from public.stages s
where s.paid_at is not null
  and s.amount is not null
  and s.amount > 0
  and not exists (
    select 1 from public.stage_payments p where p.stage_id = s.id
  );

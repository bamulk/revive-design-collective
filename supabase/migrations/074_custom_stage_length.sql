-- Stage length is no longer limited to 60 or 90 days — any whole number
-- of days up to a year. Replace the two-value check with a range.
alter table public.stages
  drop constraint if exists stages_stage_length_days_check;
alter table public.stages
  add constraint stages_stage_length_days_check
  check (stage_length_days between 1 and 365);

-- The agreement's term clause hard-coded "two months of staging", which
-- contradicts any stage that isn't 60 days. Swap in the {{rental_period}}
-- placeholder so the clause prints this stage's real length. Targeted at
-- that phrase only, so other template edits are untouched.
update public.contract_template
set terms = (
  select jsonb_agg(
    case
      when t->>'body' like '%two months of staging%' then
        jsonb_set(t, '{body}',
          to_jsonb(replace(t->>'body', 'two months of staging', '{{rental_period}} of staging')))
      else t
    end
    order by ord
  )
  from jsonb_array_elements(terms) with ordinality as e(t, ord)
)
where id = 1
  and terms::text like '%two months of staging%';

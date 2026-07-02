-- Property-specific details captured at stage creation: square footage,
-- bedroom count, bathroom count. Bathroom is numeric so 2.5 / 3.5 work.

alter table public.stages
  add column if not exists square_footage integer,
  add column if not exists bedrooms smallint,
  add column if not exists bathrooms numeric(3, 1);

-- Cached geocoded coordinates for each stage's address. Filled in the
-- first time a stage page is viewed; subsequent visits skip the
-- geocoder.

alter table public.stages
  add column if not exists lat double precision,
  add column if not exists lng double precision;

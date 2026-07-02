-- Split the address into number+street ("address") and city.
-- Helps with geocoding accuracy and lets the UI show the city as a
-- subtitle under the street address.
alter table public.stages
  add column if not exists city text;

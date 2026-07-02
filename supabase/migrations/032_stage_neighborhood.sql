-- General-area label for a stage (e.g. "East Sacramento", "Natomas").
-- Zillow doesn't expose neighborhood through any endpoint we can
-- reach, so this is reverse-geocoded from the cached lat/lng via
-- Nominatim (suburb / neighbourhood / city_district) and cached here.
ALTER TABLE public.stages
  ADD COLUMN IF NOT EXISTS neighborhood text;

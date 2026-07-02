-- Per-stage "primary only" flag. When true, the crew is staging only
-- the primary living areas (living, kitchen, master) rather than the
-- whole house. Surfaces on the stage detail page so the team knows
-- what to load on the truck.
ALTER TABLE public.stages
  ADD COLUMN IF NOT EXISTS primary_only boolean NOT NULL DEFAULT false;

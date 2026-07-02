-- Optional travel fee on a stage. Two preset tiers — $200 and $300.
-- Defaults to 0 (no fee). Included in stages.amount so the invoice
-- and reporting math just works.
ALTER TABLE public.stages
  ADD COLUMN IF NOT EXISTS travel_fee numeric(10, 2) NOT NULL DEFAULT 0;

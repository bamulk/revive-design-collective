-- Escrow payment flag. When true, the client is paying through escrow,
-- which adds a fixed $350 fee. The fee is included in stages.amount so
-- the invoice and reporting math just works.
ALTER TABLE public.stages
  ADD COLUMN IF NOT EXISTS escrow boolean NOT NULL DEFAULT false;

-- Custom pricing line items (each a free-form description + price) that
-- flow onto the estimate, contract, and invoice for a stage/estimate.
-- (Applied to the live DB via MCP as 053; idempotent.)
alter table public.stages
  add column if not exists line_items jsonb not null default '[]'::jsonb;

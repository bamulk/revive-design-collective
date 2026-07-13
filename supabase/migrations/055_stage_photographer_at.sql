-- Photographer arrival deadline for a stage — the staging work must be
-- finished before this moment. Admins set it; all team members see it
-- (with a countdown) on the stage page.
-- (Applied to the live DB via MCP as 055; idempotent.)
alter table public.stages
  add column if not exists photographer_at timestamptz;

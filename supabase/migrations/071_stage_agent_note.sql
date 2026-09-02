-- A short note written on the stage form that prints in the signer-choice
-- email sent to the agent. Kept separate from stages.notes, which is the
-- team's internal note and must never leave the app.
alter table public.stages
  add column if not exists agent_note text;

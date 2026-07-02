-- Lockbox code for a stage's property — stored as text so leading zeros and
-- non-numeric codes (e.g. alphanumeric Supra codes) are preserved.
-- Run this in your Supabase SQL editor.

alter table public.stages
  add column if not exists lockbox_code text;

-- Package + add-on pricing on stages.
-- `amount` is the computed total (existing column); these columns capture the
-- breakdown so the contract and invoice can itemize.
--
-- Run this in your Supabase SQL editor.

alter table public.stages
  add column if not exists package_key text,
  add column if not exists add_ons jsonb not null default '[]'::jsonb,
  add column if not exists discount numeric not null default 0;

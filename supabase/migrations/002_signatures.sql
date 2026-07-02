-- Signature request tracking on stages.
-- Run this in your Supabase SQL editor.

alter table public.stages
  add column if not exists signature_envelope_id text,
  add column if not exists signature_status text,
  add column if not exists signature_sent_at timestamptz,
  add column if not exists signature_completed_at timestamptz,
  add column if not exists signature_signer_email text,
  add column if not exists signed_pdf_url text;

-- Storage bucket for generated contract PDFs (both the unsigned template we
-- hand to SignatureAPI and the signed deliverable we cache after completion).
-- Public so SignatureAPI can fetch the document URL we pass when creating an
-- envelope. Path obscurity + random filenames keep it effectively private.
insert into storage.buckets (id, name, public)
values ('contracts', 'contracts', true)
on conflict (id) do nothing;

drop policy if exists "contracts_public_read" on storage.objects;
create policy "contracts_public_read" on storage.objects
  for select using (bucket_id = 'contracts');

drop policy if exists "contracts_authed_write" on storage.objects;
create policy "contracts_authed_write" on storage.objects
  for insert with check (bucket_id = 'contracts' and auth.role() = 'authenticated');

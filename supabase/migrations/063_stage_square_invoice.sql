-- Traceability + idempotency for the one-time Square Invoicing import.
-- Each stage created from a Square invoice records its originating invoice
-- number, so the importer can skip invoices it has already loaded on re-run
-- and staff can trace a project back to its Square invoice.
alter table public.stages
  add column if not exists square_invoice_number text;

-- Partial unique index: at most one stage per Square invoice number, but
-- unlimited NULLs for stages created inside the app.
create unique index if not exists stages_square_invoice_number_key
  on public.stages(square_invoice_number)
  where square_invoice_number is not null;

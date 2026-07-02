-- Invoice + payment tracking on stages. Run in Supabase SQL editor
-- (already applied via MCP for prod).

alter table public.stages
  add column if not exists invoice_pdf_url text,
  add column if not exists invoice_generated_at timestamptz,
  add column if not exists invoice_sent_at timestamptz,
  add column if not exists paid_at timestamptz,
  add column if not exists payment_method text;

alter table public.stages
  drop constraint if exists stages_payment_method_check;
alter table public.stages
  add constraint stages_payment_method_check
  check (
    payment_method is null
    or payment_method in ('check','cash','zelle','venmo','card','other')
  );

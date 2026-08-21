-- True once an agreement envelope carrying the initialed "Additional
-- Fees" block has been sent for this stage. Fee invoices/emails only
-- cite "initialed by client" when this is set AND the agreement was
-- signed; older agreements predate the clause.
ALTER TABLE stages ADD COLUMN IF NOT EXISTS agreement_fee_initials boolean NOT NULL DEFAULT false;

-- Per-stage billing entity (e.g. the LLC a flipper buys under) —
-- printed as the invoice's Bill To name with the client as c/o.
ALTER TABLE stages ADD COLUMN IF NOT EXISTS bill_to text;

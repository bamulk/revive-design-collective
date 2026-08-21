-- Extra charges reported by the crew on arrival (no lockbox key, house
-- inaccessible, house not ready). Each report becomes a fee invoice
-- that an admin approves before it's emailed to the client.
CREATE TABLE IF NOT EXISTS stage_fees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id uuid NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  reasons text[] NOT NULL,
  note text,
  amount numeric(10,2) NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'paid', 'dismissed')),
  reported_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  reported_by_name text,
  reported_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  approved_at timestamptz,
  invoice_number text,
  pdf_url text,
  sent_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stage_fees_stage_id_idx ON stage_fees(stage_id);
CREATE INDEX IF NOT EXISTS stage_fees_status_idx ON stage_fees(status);
ALTER TABLE stage_fees ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "stage_fees internal" ON stage_fees;
CREATE POLICY "stage_fees internal" ON stage_fees
  FOR ALL USING (is_internal_user()) WITH CHECK (is_internal_user());

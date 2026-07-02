-- Per-extension history. Replaces the single set of extension_*
-- columns on stages, which only retained the latest extension's
-- amount / pdf / paid state. The stages columns stick around for
-- backward compat (extension_count is still used as a quick rollup),
-- but the source of truth for individual extensions moves here.
CREATE TABLE IF NOT EXISTS public.stage_extensions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id uuid NOT NULL REFERENCES public.stages(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  extension_date date,
  amount numeric(10, 2) NOT NULL DEFAULT 0,
  paid_at timestamptz,
  pdf_url text,
  pdf_sent_at timestamptz,
  source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'auto'))
);

CREATE INDEX IF NOT EXISTS stage_extensions_stage_id_idx
  ON public.stage_extensions (stage_id, created_at);

ALTER TABLE public.stage_extensions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stage_extensions_authed_all ON public.stage_extensions;
CREATE POLICY stage_extensions_authed_all
  ON public.stage_extensions
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Backfill from the latest known extension state on stages. Older
-- extensions (count > 1) lose detail — there's no per-row history
-- to reconstruct.
INSERT INTO public.stage_extensions (
  stage_id, extension_date, amount, paid_at, pdf_url, source
)
SELECT
  s.id,
  s.destage_date,
  COALESCE(s.extension_invoice_amount, 0),
  s.extension_invoice_paid_at,
  s.extension_invoice_pdf_url,
  CASE WHEN s.extension_invoice_pdf_url IS NULL THEN 'manual' ELSE 'auto' END
FROM public.stages s
WHERE COALESCE(s.extension_count, 0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.stage_extensions e WHERE e.stage_id = s.id
  );

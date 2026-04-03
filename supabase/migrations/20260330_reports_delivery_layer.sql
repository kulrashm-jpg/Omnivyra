-- Delivery Layer: reports persistence compatibility for orchestrated decision reports
-- Adds requested fields: report_id, json_output while remaining backward compatible.

BEGIN;

CREATE TABLE IF NOT EXISTS public.reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  report_type VARCHAR(100) NOT NULL,
  json_output JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS report_id TEXT,
  ADD COLUMN IF NOT EXISTS json_output JSONB;

UPDATE public.reports
SET report_id = COALESCE(report_id, id::text)
WHERE report_id IS NULL;

UPDATE public.reports
SET json_output = COALESCE(json_output, data)
WHERE json_output IS NULL;

ALTER TABLE public.reports
  ALTER COLUMN report_id SET DEFAULT gen_random_uuid()::text;

ALTER TABLE public.reports
  ALTER COLUMN report_id SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'valid_report_type'
      AND conrelid = 'public.reports'::regclass
  ) THEN
    ALTER TABLE public.reports DROP CONSTRAINT valid_report_type;
  END IF;
END $$;

ALTER TABLE public.reports
  ADD CONSTRAINT valid_report_type CHECK (
    report_type IN (
      'content_readiness',
      'competitor_analysis',
      'gap_analysis',
      'snapshot',
      'performance',
      'growth',
      'strategic'
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_report_id_unique
  ON public.reports(report_id);

CREATE INDEX IF NOT EXISTS idx_reports_company_type_created
  ON public.reports(company_id, report_type, created_at DESC);

COMMIT;

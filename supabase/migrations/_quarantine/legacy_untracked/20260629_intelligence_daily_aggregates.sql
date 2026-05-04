BEGIN;

CREATE TABLE IF NOT EXISTS public.intelligence_daily_aggregates (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  date               DATE        NOT NULL,
  total_touchpoints  INTEGER     NOT NULL DEFAULT 0,
  total_leads        INTEGER     NOT NULL DEFAULT 0,
  total_revenue      NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_gaps         INTEGER     NOT NULL DEFAULT 0,
  total_prompts      INTEGER     NOT NULL DEFAULT 0,
  attributed_revenue NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT intelligence_daily_aggregates_non_negative
    CHECK (
      total_touchpoints >= 0
      AND total_leads >= 0
      AND total_revenue >= 0
      AND total_gaps >= 0
      AND total_prompts >= 0
      AND attributed_revenue >= 0
    ),
  CONSTRAINT intelligence_daily_aggregates_company_date_unique
    UNIQUE (company_id, date)
);

CREATE INDEX IF NOT EXISTS idx_intelligence_daily_aggregates_company_date
  ON public.intelligence_daily_aggregates(company_id, date DESC);

ALTER TABLE public.intelligence_daily_aggregates ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'intelligence_daily_aggregates'
      AND policyname = 'service_role_full_access'
  ) THEN
    DROP POLICY "service_role_full_access" ON public.intelligence_daily_aggregates;
  END IF;

  CREATE POLICY "service_role_full_access"
    ON public.intelligence_daily_aggregates
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
END $$;

COMMENT ON TABLE public.intelligence_daily_aggregates IS
  'Lightweight daily pre-aggregates for Intelligence dashboard totals. Built from unified touchpoints, gaps, prompts, and attribution results.';

COMMIT;

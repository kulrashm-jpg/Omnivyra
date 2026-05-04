BEGIN;

CREATE TABLE IF NOT EXISTS public.attribution_results (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  unified_person_id        UUID        NOT NULL REFERENCES public.unified_persons(id) ON DELETE CASCADE,
  revenue_touchpoint_id    UUID        NOT NULL REFERENCES public.unified_touchpoints(id) ON DELETE CASCADE,
  attributed_touchpoint_id UUID        NOT NULL REFERENCES public.unified_touchpoints(id) ON DELETE CASCADE,
  attribution_type         TEXT        NOT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT attribution_results_type_valid
    CHECK (attribution_type IN ('last_touch')),
  CONSTRAINT attribution_results_distinct_touchpoints
    CHECK (revenue_touchpoint_id <> attributed_touchpoint_id),
  CONSTRAINT attribution_results_revenue_unique
    UNIQUE (revenue_touchpoint_id)
);

CREATE INDEX IF NOT EXISTS idx_attribution_results_company_person
  ON public.attribution_results(company_id, unified_person_id);

CREATE INDEX IF NOT EXISTS idx_attribution_results_attributed_touchpoint
  ON public.attribution_results(attributed_touchpoint_id);

ALTER TABLE public.attribution_results ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'attribution_results'
      AND policyname = 'service_role_full_access'
  ) THEN
    DROP POLICY "service_role_full_access" ON public.attribution_results;
  END IF;

  CREATE POLICY "service_role_full_access"
    ON public.attribution_results
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
END $$;

COMMENT ON TABLE public.attribution_results IS
  'Attribution outputs derived from unified touchpoints. Initial support is one last-touch attribution row per revenue touchpoint.';

COMMENT ON COLUMN public.attribution_results.revenue_touchpoint_id IS
  'Revenue touchpoint being attributed. This is unique so attribution processing is idempotent.';

COMMENT ON COLUMN public.attribution_results.attributed_touchpoint_id IS
  'Latest prior non-revenue touchpoint credited by the attribution model.';

COMMIT;

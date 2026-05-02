BEGIN;

CREATE TABLE IF NOT EXISTS public.unified_touchpoints (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  unified_person_id UUID        REFERENCES public.unified_persons(id) ON DELETE SET NULL,
  source            TEXT        NOT NULL,
  unified_source    JSONB       NOT NULL DEFAULT '{}'::jsonb,
  touchpoint_type   TEXT        NOT NULL,
  reference_table   TEXT        NOT NULL,
  reference_id      TEXT        NOT NULL,
  occurred_at       TIMESTAMPTZ NOT NULL,
  metadata          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT unified_touchpoints_source_not_blank
    CHECK (LENGTH(BTRIM(source)) > 0),
  CONSTRAINT unified_touchpoints_type_not_blank
    CHECK (LENGTH(BTRIM(touchpoint_type)) > 0),
  CONSTRAINT unified_touchpoints_reference_table_not_blank
    CHECK (LENGTH(BTRIM(reference_table)) > 0),
  CONSTRAINT unified_touchpoints_reference_id_not_blank
    CHECK (LENGTH(BTRIM(reference_id)) > 0),
  CONSTRAINT unified_touchpoints_unified_source_object
    CHECK (jsonb_typeof(unified_source) = 'object'),
  CONSTRAINT unified_touchpoints_metadata_object
    CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT unified_touchpoints_reference_unique
    UNIQUE (company_id, reference_table, reference_id)
);

CREATE INDEX IF NOT EXISTS idx_unified_touchpoints_company_person
  ON public.unified_touchpoints(company_id, unified_person_id);

CREATE INDEX IF NOT EXISTS idx_unified_touchpoints_company_type
  ON public.unified_touchpoints(company_id, touchpoint_type);

CREATE INDEX IF NOT EXISTS idx_unified_touchpoints_occurred_at
  ON public.unified_touchpoints(occurred_at);

ALTER TABLE public.unified_touchpoints ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'unified_touchpoints'
      AND policyname = 'service_role_full_access'
  ) THEN
    DROP POLICY "service_role_full_access" ON public.unified_touchpoints;
  END IF;

  CREATE POLICY "service_role_full_access"
    ON public.unified_touchpoints
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
END $$;

COMMENT ON TABLE public.unified_touchpoints IS
  'Unified activity timeline for attribution, gap detection, expected-event modeling, and per-person intelligence.';

COMMENT ON COLUMN public.unified_touchpoints.reference_table IS
  'Canonical or source table that owns the source record for idempotency and traceability.';

COMMENT ON COLUMN public.unified_touchpoints.reference_id IS
  'Reference row id or external id stored as text so UUID and non-UUID source ids can share the same spine.';

COMMIT;

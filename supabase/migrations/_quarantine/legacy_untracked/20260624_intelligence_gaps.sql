BEGIN;

CREATE TABLE IF NOT EXISTS public.intelligence_gaps (
  id                         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                 UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  unified_person_id          UUID        REFERENCES public.unified_persons(id) ON DELETE SET NULL,
  expected_event_instance_id UUID        NOT NULL REFERENCES public.expected_event_instances(id) ON DELETE CASCADE,
  gap_type                   TEXT        NOT NULL,
  priority                   TEXT        NOT NULL DEFAULT 'medium',
  status                     TEXT        NOT NULL DEFAULT 'open',
  detected_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at                TIMESTAMPTZ,
  metadata                   JSONB       NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT intelligence_gaps_type_not_blank
    CHECK (LENGTH(BTRIM(gap_type)) > 0),
  CONSTRAINT intelligence_gaps_priority_valid
    CHECK (priority IN ('low', 'medium', 'high')),
  CONSTRAINT intelligence_gaps_status_valid
    CHECK (status IN ('open', 'resolved', 'dismissed')),
  CONSTRAINT intelligence_gaps_metadata_object
    CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT intelligence_gaps_expected_instance_unique
    UNIQUE (expected_event_instance_id)
);

CREATE INDEX IF NOT EXISTS idx_intelligence_gaps_company_status
  ON public.intelligence_gaps(company_id, status, detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_intelligence_gaps_company_type_status
  ON public.intelligence_gaps(company_id, gap_type, status);

CREATE INDEX IF NOT EXISTS idx_intelligence_gaps_expected_event
  ON public.intelligence_gaps(expected_event_instance_id);

ALTER TABLE public.intelligence_gaps ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'intelligence_gaps'
      AND policyname = 'service_role_full_access'
  ) THEN
    DROP POLICY "service_role_full_access" ON public.intelligence_gaps;
  END IF;

  CREATE POLICY "service_role_full_access"
    ON public.intelligence_gaps
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
END $$;

COMMENT ON TABLE public.intelligence_gaps IS
  'Actionable records created when expected-event instances are missed and resolved when the chain is completed.';

COMMENT ON COLUMN public.intelligence_gaps.expected_event_instance_id IS
  'One-to-one link to the missed expected event instance that produced this gap.';

COMMIT;

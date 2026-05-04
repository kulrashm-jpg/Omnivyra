BEGIN;

CREATE TABLE IF NOT EXISTS public.expected_event_definitions (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID        REFERENCES public.companies(id) ON DELETE CASCADE,
  source_provider     TEXT        NOT NULL,
  trigger_event_type  TEXT        NOT NULL,
  expected_event_type TEXT        NOT NULL,
  max_delay_hours     INTEGER     NOT NULL,
  is_required         BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT expected_event_definitions_provider_not_blank
    CHECK (LENGTH(BTRIM(source_provider)) > 0),
  CONSTRAINT expected_event_definitions_trigger_not_blank
    CHECK (LENGTH(BTRIM(trigger_event_type)) > 0),
  CONSTRAINT expected_event_definitions_expected_not_blank
    CHECK (LENGTH(BTRIM(expected_event_type)) > 0),
  CONSTRAINT expected_event_definitions_delay_positive
    CHECK (max_delay_hours > 0)
);

CREATE INDEX IF NOT EXISTS idx_expected_event_definitions_lookup
  ON public.expected_event_definitions(company_id, source_provider, trigger_event_type);

CREATE TABLE IF NOT EXISTS public.expected_event_instances (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  unified_person_id        UUID        REFERENCES public.unified_persons(id) ON DELETE SET NULL,
  trigger_touchpoint_id    UUID        NOT NULL REFERENCES public.unified_touchpoints(id) ON DELETE CASCADE,
  expected_event_type      TEXT        NOT NULL,
  due_at                   TIMESTAMPTZ NOT NULL,
  status                   TEXT        NOT NULL DEFAULT 'pending',
  completed_touchpoint_id  UUID        REFERENCES public.unified_touchpoints(id) ON DELETE SET NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT expected_event_instances_expected_not_blank
    CHECK (LENGTH(BTRIM(expected_event_type)) > 0),
  CONSTRAINT expected_event_instances_status_valid
    CHECK (status IN ('pending', 'completed', 'missed')),
  CONSTRAINT expected_event_instances_trigger_expected_unique
    UNIQUE (trigger_touchpoint_id, expected_event_type)
);

CREATE INDEX IF NOT EXISTS idx_expected_event_instances_company_person
  ON public.expected_event_instances(company_id, unified_person_id);

CREATE INDEX IF NOT EXISTS idx_expected_event_instances_status_due
  ON public.expected_event_instances(status, due_at);

CREATE INDEX IF NOT EXISTS idx_expected_event_instances_company_expected_status
  ON public.expected_event_instances(company_id, expected_event_type, status);

DROP TRIGGER IF EXISTS trg_expected_event_instances_updated_at ON public.expected_event_instances;
CREATE TRIGGER trg_expected_event_instances_updated_at
  BEFORE UPDATE ON public.expected_event_instances
  FOR EACH ROW
  EXECUTE FUNCTION omnivyra_touch_updated_at();

INSERT INTO public.expected_event_definitions (
  company_id,
  source_provider,
  trigger_event_type,
  expected_event_type,
  max_delay_hours,
  is_required
)
SELECT
  NULL,
  'crm',
  'lead_created',
  'revenue',
  720,
  TRUE
WHERE NOT EXISTS (
  SELECT 1
  FROM public.expected_event_definitions
  WHERE company_id IS NULL
    AND source_provider = 'crm'
    AND trigger_event_type = 'lead_created'
    AND expected_event_type = 'revenue'
);

ALTER TABLE public.expected_event_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expected_event_instances ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t TEXT;
  protected_tables TEXT[] := ARRAY[
    'expected_event_definitions',
    'expected_event_instances'
  ];
BEGIN
  FOREACH t IN ARRAY protected_tables LOOP
    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = t
        AND policyname = 'service_role_full_access'
    ) THEN
      EXECUTE format('DROP POLICY "service_role_full_access" ON public.%I', t);
    END IF;

    EXECUTE format(
      'CREATE POLICY "service_role_full_access" ON public.%I FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')',
      t
    );
  END LOOP;
END $$;

COMMENT ON TABLE public.expected_event_definitions IS
  'Declarative expected-event rules used to create gap-tracking instances from touchpoints.';

COMMENT ON TABLE public.expected_event_instances IS
  'Per-person expected events created from touchpoint triggers and later completed or marked missed.';

COMMIT;

BEGIN;

CREATE TABLE IF NOT EXISTS public.unified_persons (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  primary_email TEXT,
  primary_phone TEXT,
  external_keys JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT unified_persons_email_not_blank
    CHECK (primary_email IS NULL OR LENGTH(BTRIM(primary_email)) > 0),
  CONSTRAINT unified_persons_phone_not_blank
    CHECK (primary_phone IS NULL OR LENGTH(BTRIM(primary_phone)) > 0),
  CONSTRAINT unified_persons_external_keys_object
    CHECK (jsonb_typeof(external_keys) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_unified_persons_company_email
  ON public.unified_persons(company_id, primary_email)
  WHERE primary_email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_unified_persons_company_phone
  ON public.unified_persons(company_id, primary_phone)
  WHERE primary_phone IS NOT NULL;

DROP TRIGGER IF EXISTS trg_unified_persons_updated_at ON public.unified_persons;
CREATE TRIGGER trg_unified_persons_updated_at
  BEFORE UPDATE ON public.unified_persons
  FOR EACH ROW
  EXECUTE FUNCTION omnivyra_touch_updated_at();

ALTER TABLE public.canonical_users
  ADD COLUMN IF NOT EXISTS unified_person_id UUID REFERENCES public.unified_persons(id) ON DELETE SET NULL;

ALTER TABLE public.canonical_leads
  ADD COLUMN IF NOT EXISTS unified_person_id UUID REFERENCES public.unified_persons(id) ON DELETE SET NULL;

ALTER TABLE public.canonical_revenue_events
  ADD COLUMN IF NOT EXISTS unified_person_id UUID REFERENCES public.unified_persons(id) ON DELETE SET NULL;

ALTER TABLE IF EXISTS public.engagement_threads
  ADD COLUMN IF NOT EXISTS unified_person_id UUID REFERENCES public.unified_persons(id) ON DELETE SET NULL;

ALTER TABLE IF EXISTS public.contacts
  ADD COLUMN IF NOT EXISTS unified_person_id UUID REFERENCES public.unified_persons(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_canonical_users_unified_person
  ON public.canonical_users(unified_person_id)
  WHERE unified_person_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_canonical_leads_unified_person
  ON public.canonical_leads(unified_person_id)
  WHERE unified_person_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_canonical_revenue_events_unified_person
  ON public.canonical_revenue_events(unified_person_id)
  WHERE unified_person_id IS NOT NULL;

DO $$
BEGIN
  IF to_regclass('public.engagement_threads') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_engagement_threads_unified_person
      ON public.engagement_threads(unified_person_id)
      WHERE unified_person_id IS NOT NULL;
  END IF;

  IF to_regclass('public.contacts') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_contacts_unified_person
      ON public.contacts(unified_person_id)
      WHERE unified_person_id IS NOT NULL;
  END IF;
END $$;

ALTER TABLE public.unified_persons ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'unified_persons'
      AND policyname = 'service_role_full_access'
  ) THEN
    DROP POLICY "service_role_full_access" ON public.unified_persons;
  END IF;

  CREATE POLICY "service_role_full_access"
    ON public.unified_persons
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
END $$;

COMMENT ON TABLE public.unified_persons IS
  'Unified identity spine for linking analytics, CRM, lead, and engagement records to a person without replacing existing source keys.';

COMMENT ON COLUMN public.canonical_users.unified_person_id IS
  'Optional additive link to unified_persons identity spine.';
COMMENT ON COLUMN public.canonical_leads.unified_person_id IS
  'Optional additive link to unified_persons identity spine.';
COMMENT ON COLUMN public.canonical_revenue_events.unified_person_id IS
  'Optional additive link to unified_persons identity spine.';
DO $$
BEGIN
  IF to_regclass('public.engagement_threads') IS NOT NULL THEN
    COMMENT ON COLUMN public.engagement_threads.unified_person_id IS
      'Optional additive link to unified_persons identity spine.';
  END IF;

  IF to_regclass('public.contacts') IS NOT NULL THEN
    COMMENT ON COLUMN public.contacts.unified_person_id IS
      'Optional additive link to unified_persons identity spine.';
  END IF;
END $$;

COMMIT;

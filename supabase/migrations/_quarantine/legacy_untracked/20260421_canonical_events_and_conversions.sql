BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'canonical_event_source') THEN
    CREATE TYPE public.canonical_event_source AS ENUM ('GA4', 'OMNIVERA');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.canonical_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  event_category TEXT NOT NULL,
  page_url TEXT,
  event_timestamp TIMESTAMPTZ NOT NULL,
  source public.canonical_event_source NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT canonical_events_event_name_not_blank
    CHECK (length(btrim(event_name)) > 0),
  CONSTRAINT canonical_events_event_category_valid
    CHECK (event_category IN ('navigation', 'engagement', 'conversion'))
);

CREATE TABLE IF NOT EXISTS public.canonical_conversions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  conversion_name TEXT NOT NULL,
  conversion_value NUMERIC(12,2),
  page_url TEXT,
  conversion_timestamp TIMESTAMPTZ NOT NULL,
  source public.canonical_event_source NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT canonical_conversions_name_not_blank
    CHECK (length(btrim(conversion_name)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_canonical_events_company_timestamp
  ON public.canonical_events(company_id, event_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_canonical_events_company_session
  ON public.canonical_events(company_id, session_id, event_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_canonical_events_company_event_name
  ON public.canonical_events(company_id, event_name, event_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_canonical_conversions_company_timestamp
  ON public.canonical_conversions(company_id, conversion_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_canonical_conversions_company_session
  ON public.canonical_conversions(company_id, session_id, conversion_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_canonical_conversions_company_name
  ON public.canonical_conversions(company_id, conversion_name, conversion_timestamp DESC);

ALTER TABLE public.canonical_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_conversions ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t TEXT;
  protected_tables TEXT[] := ARRAY['canonical_events', 'canonical_conversions'];
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
END
$$;

COMMIT;

BEGIN;

CREATE TABLE IF NOT EXISTS public.integrations (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  provider         TEXT        NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'disconnected',
  auth_type        TEXT        NOT NULL,
  credentials      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  last_sync_at     TIMESTAMPTZ,
  last_sync_status TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT integrations_provider_not_blank
    CHECK (LENGTH(BTRIM(provider)) > 0),
  CONSTRAINT integrations_status_valid
    CHECK (status IN ('connected', 'disconnected', 'error')),
  CONSTRAINT integrations_auth_type_valid
    CHECK (auth_type IN ('api_key', 'oauth')),
  CONSTRAINT integrations_credentials_object
    CHECK (jsonb_typeof(credentials) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_integrations_company_provider
  ON public.integrations(company_id, provider);

CREATE INDEX IF NOT EXISTS idx_integrations_company_status
  ON public.integrations(company_id, status);

ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'integrations'
      AND policyname = 'service_role_full_access'
  ) THEN
    DROP POLICY "service_role_full_access" ON public.integrations;
  END IF;

  CREATE POLICY "service_role_full_access"
    ON public.integrations
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
END $$;

COMMENT ON TABLE public.integrations IS
  'Provider-level integration connections with authentication placeholder credentials and sync status tracking for CRM, email, webinar, and future adapters.';

COMMENT ON COLUMN public.integrations.credentials IS
  'Credential payload placeholder. Encrypt or externalize before storing production secrets.';

COMMIT;

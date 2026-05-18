-- Omnivera Website Intelligence Foundation - Phase 1
-- Adds canonical website, CMS connection, publishing, attribution, and
-- tracking spine tables. All relationships are nullable/additive so existing
-- forms, leads, blogs, and integrations continue to work during migration.

BEGIN;

CREATE TABLE IF NOT EXISTS public.websites (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  domain_id     UUID NULL REFERENCES public.company_domains(id) ON DELETE SET NULL,
  name          TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  cms_provider  TEXT NULL,
  status        TEXT NOT NULL DEFAULT 'active',
  settings      JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by    UUID NULL,
  deleted_at    TIMESTAMPTZ NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT websites_status_check
    CHECK (status IN ('active','inactive','pending_verification','archived','deleted')),
  CONSTRAINT websites_canonical_url_not_blank
    CHECK (LENGTH(BTRIM(canonical_url)) > 0),
  CONSTRAINT websites_name_not_blank
    CHECK (LENGTH(BTRIM(name)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_websites_company_id
  ON public.websites(company_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_websites_domain_id
  ON public.websites(domain_id)
  WHERE domain_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_websites_company_provider
  ON public.websites(company_id, cms_provider)
  WHERE cms_provider IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_websites_company_canonical_url_active
  ON public.websites(company_id, LOWER(canonical_url))
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.website_connections (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id            UUID NOT NULL REFERENCES public.websites(id) ON DELETE CASCADE,
  provider              TEXT NOT NULL,
  auth_type             TEXT NOT NULL DEFAULT 'api_key',
  encrypted_credentials JSONB NOT NULL DEFAULT '{}'::jsonb,
  non_secret_config     JSONB NOT NULL DEFAULT '{}'::jsonb,
  status                TEXT NOT NULL DEFAULT 'pending',
  health_status         TEXT NOT NULL DEFAULT 'unknown',
  last_sync_at          TIMESTAMPTZ NULL,
  last_error            TEXT NULL,
  deleted_at            TIMESTAMPTZ NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT website_connections_status_check
    CHECK (status IN ('pending','connected','failed','disabled','deleted')),
  CONSTRAINT website_connections_health_check
    CHECK (health_status IN ('unknown','healthy','degraded','failed'))
);

CREATE INDEX IF NOT EXISTS idx_website_connections_website_id
  ON public.website_connections(website_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_website_connections_provider
  ON public.website_connections(provider)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_website_connections_website_provider
  ON public.website_connections(website_id, provider)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.integration_credentials (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id  UUID NOT NULL REFERENCES public.website_connections(id) ON DELETE CASCADE,
  credential_key TEXT NOT NULL,
  encrypted_value TEXT NOT NULL,
  rotated_at     TIMESTAMPTZ NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT integration_credentials_key_not_blank
    CHECK (LENGTH(BTRIM(credential_key)) > 0),
  CONSTRAINT integration_credentials_connection_key_unique
    UNIQUE (connection_id, credential_key)
);

CREATE INDEX IF NOT EXISTS idx_integration_credentials_connection_id
  ON public.integration_credentials(connection_id);

ALTER TABLE public.company_integrations
  ADD COLUMN IF NOT EXISTS website_id UUID NULL REFERENCES public.websites(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS website_connection_id UUID NULL REFERENCES public.website_connections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS non_secret_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS credential_migration_status TEXT NOT NULL DEFAULT 'legacy';

CREATE INDEX IF NOT EXISTS idx_company_integrations_website_id
  ON public.company_integrations(website_id)
  WHERE website_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_company_integrations_connection_id
  ON public.company_integrations(website_connection_id)
  WHERE website_connection_id IS NOT NULL;

ALTER TABLE public.forms
  ADD COLUMN IF NOT EXISTS website_id UUID NULL REFERENCES public.websites(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS allowed_domains TEXT[] NOT NULL DEFAULT '{}'::text[];
CREATE INDEX IF NOT EXISTS idx_forms_website_id
  ON public.forms(website_id)
  WHERE website_id IS NOT NULL;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS website_id UUID NULL REFERENCES public.websites(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS visitor_session_id UUID NULL,
  ADD COLUMN IF NOT EXISTS attribution JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS consent_state TEXT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_website_id
  ON public.leads(website_id)
  WHERE website_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_visitor_session_id
  ON public.leads(visitor_session_id)
  WHERE visitor_session_id IS NOT NULL;

ALTER TABLE public.blogs
  ADD COLUMN IF NOT EXISTS website_id UUID NULL REFERENCES public.websites(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS scheduled_publish_at TIMESTAMPTZ NULL;
CREATE INDEX IF NOT EXISTS idx_blogs_website_id
  ON public.blogs(website_id)
  WHERE website_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.publishing_jobs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  website_id          UUID NULL REFERENCES public.websites(id) ON DELETE SET NULL,
  connection_id       UUID NULL REFERENCES public.website_connections(id) ON DELETE SET NULL,
  blog_id             UUID NULL REFERENCES public.blogs(id) ON DELETE SET NULL,
  provider            TEXT NOT NULL,
  job_type            TEXT NOT NULL DEFAULT 'publish_post',
  status              TEXT NOT NULL DEFAULT 'queued',
  idempotency_key     TEXT NOT NULL,
  scheduled_for       TIMESTAMPTZ NULL,
  attempt_count       INTEGER NOT NULL DEFAULT 0,
  max_attempts        INTEGER NOT NULL DEFAULT 3,
  request_payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  provider_response   JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_error          TEXT NULL,
  created_by          UUID NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at        TIMESTAMPTZ NULL,
  CONSTRAINT publishing_jobs_status_check
    CHECK (status IN ('queued','scheduled','running','succeeded','failed','cancelled','retrying')),
  CONSTRAINT publishing_jobs_type_check
    CHECK (job_type IN ('publish_post','update_post','schedule_post','sync_post','upload_media')),
  CONSTRAINT publishing_jobs_idempotency_unique
    UNIQUE (company_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_publishing_jobs_company_status
  ON public.publishing_jobs(company_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_publishing_jobs_website_id
  ON public.publishing_jobs(website_id)
  WHERE website_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_publishing_jobs_connection_id
  ON public.publishing_jobs(connection_id)
  WHERE connection_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_publishing_jobs_scheduled_for
  ON public.publishing_jobs(scheduled_for)
  WHERE scheduled_for IS NOT NULL AND status IN ('queued','scheduled','retrying');

CREATE TABLE IF NOT EXISTS public.publishing_attempts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id            UUID NOT NULL REFERENCES public.publishing_jobs(id) ON DELETE CASCADE,
  attempt_number    INTEGER NOT NULL,
  status            TEXT NOT NULL,
  request_payload   JSONB NOT NULL DEFAULT '{}'::jsonb,
  provider_response JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message     TEXT NULL,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at       TIMESTAMPTZ NULL,
  CONSTRAINT publishing_attempts_status_check
    CHECK (status IN ('running','succeeded','failed','cancelled'))
);
CREATE INDEX IF NOT EXISTS idx_publishing_attempts_job_id
  ON public.publishing_attempts(job_id, attempt_number DESC);

CREATE TABLE IF NOT EXISTS public.integration_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  website_id    UUID NULL REFERENCES public.websites(id) ON DELETE SET NULL,
  connection_id UUID NULL REFERENCES public.website_connections(id) ON DELETE SET NULL,
  provider      TEXT NOT NULL,
  level         TEXT NOT NULL DEFAULT 'info',
  event_name    TEXT NOT NULL,
  message       TEXT NULL,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT integration_logs_level_check
    CHECK (level IN ('debug','info','warn','error'))
);
CREATE INDEX IF NOT EXISTS idx_integration_logs_company_created
  ON public.integration_logs(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_integration_logs_connection_id
  ON public.integration_logs(connection_id)
  WHERE connection_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.webhook_events (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         UUID NULL REFERENCES public.companies(id) ON DELETE SET NULL,
  website_id         UUID NULL REFERENCES public.websites(id) ON DELETE SET NULL,
  connection_id      UUID NULL REFERENCES public.website_connections(id) ON DELETE SET NULL,
  provider           TEXT NOT NULL,
  event_type         TEXT NOT NULL,
  signature_valid    BOOLEAN NULL,
  idempotency_key    TEXT NULL,
  payload            JSONB NOT NULL DEFAULT '{}'::jsonb,
  processing_status  TEXT NOT NULL DEFAULT 'received',
  error_message      TEXT NULL,
  received_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at       TIMESTAMPTZ NULL,
  CONSTRAINT webhook_events_status_check
    CHECK (processing_status IN ('received','processing','processed','failed','ignored'))
);
CREATE INDEX IF NOT EXISTS idx_webhook_events_connection_received
  ON public.webhook_events(connection_id, received_at DESC)
  WHERE connection_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_webhook_events_connection_idempotency
  ON public.webhook_events(connection_id, idempotency_key)
  WHERE connection_id IS NOT NULL AND idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.sync_jobs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  website_id        UUID NULL REFERENCES public.websites(id) ON DELETE SET NULL,
  connection_id     UUID NULL REFERENCES public.website_connections(id) ON DELETE SET NULL,
  provider          TEXT NOT NULL,
  sync_type         TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'queued',
  cursor_payload    JSONB NOT NULL DEFAULT '{}'::jsonb,
  records_processed INTEGER NOT NULL DEFAULT 0,
  records_inserted  INTEGER NOT NULL DEFAULT 0,
  records_updated   INTEGER NOT NULL DEFAULT 0,
  last_error        TEXT NULL,
  started_at        TIMESTAMPTZ NULL,
  completed_at      TIMESTAMPTZ NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sync_jobs_status_check
    CHECK (status IN ('queued','running','succeeded','failed','cancelled','partial'))
);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_connection_status
  ON public.sync_jobs(connection_id, status, created_at DESC)
  WHERE connection_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.visitor_sessions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NULL REFERENCES public.companies(id) ON DELETE SET NULL,
  website_id          UUID NULL REFERENCES public.websites(id) ON DELETE SET NULL,
  anonymous_id        TEXT NOT NULL,
  unified_person_id   UUID NULL REFERENCES public.unified_persons(id) ON DELETE SET NULL,
  first_landing_page  TEXT NULL,
  last_current_page   TEXT NULL,
  first_referrer      TEXT NULL,
  last_referrer       TEXT NULL,
  utm_source          TEXT NULL,
  utm_medium          TEXT NULL,
  utm_campaign        TEXT NULL,
  utm_content         TEXT NULL,
  utm_term            TEXT NULL,
  first_touch         JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_touch          JSONB NOT NULL DEFAULT '{}'::jsonb,
  consent_state       TEXT NULL,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT visitor_sessions_anonymous_not_blank
    CHECK (LENGTH(BTRIM(anonymous_id)) > 0)
);
CREATE INDEX IF NOT EXISTS idx_visitor_sessions_website_id
  ON public.visitor_sessions(website_id, last_seen_at DESC)
  WHERE website_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_visitor_sessions_anonymous_id
  ON public.visitor_sessions(anonymous_id);
CREATE INDEX IF NOT EXISTS idx_visitor_sessions_unified_person
  ON public.visitor_sessions(unified_person_id)
  WHERE unified_person_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.tracking_events (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NULL REFERENCES public.companies(id) ON DELETE SET NULL,
  website_id          UUID NULL REFERENCES public.websites(id) ON DELETE SET NULL,
  visitor_session_id  UUID NULL REFERENCES public.visitor_sessions(id) ON DELETE SET NULL,
  anonymous_id        TEXT NULL,
  event_name          TEXT NOT NULL,
  event_category      TEXT NOT NULL DEFAULT 'engagement',
  page_url            TEXT NULL,
  referrer            TEXT NULL,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  consent_state       TEXT NULL,
  occurred_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tracking_events_category_check
    CHECK (event_category IN ('navigation','engagement','conversion','system'))
);
CREATE INDEX IF NOT EXISTS idx_tracking_events_website_time
  ON public.tracking_events(website_id, occurred_at DESC)
  WHERE website_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tracking_events_session_time
  ON public.tracking_events(visitor_session_id, occurred_at DESC)
  WHERE visitor_session_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.lead_attributions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id             UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  company_id          UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  website_id          UUID NULL REFERENCES public.websites(id) ON DELETE SET NULL,
  visitor_session_id  UUID NULL REFERENCES public.visitor_sessions(id) ON DELETE SET NULL,
  attribution_model   TEXT NOT NULL DEFAULT 'capture_snapshot',
  first_touch         JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_touch          JSONB NOT NULL DEFAULT '{}'::jsonb,
  utm_source          TEXT NULL,
  utm_medium          TEXT NULL,
  utm_campaign        TEXT NULL,
  utm_content         TEXT NULL,
  utm_term            TEXT NULL,
  referrer            TEXT NULL,
  landing_page        TEXT NULL,
  current_page        TEXT NULL,
  consent_state       TEXT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lead_attributions_model_check
    CHECK (attribution_model IN ('capture_snapshot','first_touch','last_touch','multi_touch'))
);
CREATE INDEX IF NOT EXISTS idx_lead_attributions_lead_id
  ON public.lead_attributions(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_attributions_company_created
  ON public.lead_attributions(company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.form_conversions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  website_id          UUID NULL REFERENCES public.websites(id) ON DELETE SET NULL,
  form_id             UUID NULL REFERENCES public.forms(id) ON DELETE SET NULL,
  lead_id             UUID NULL REFERENCES public.leads(id) ON DELETE SET NULL,
  visitor_session_id  UUID NULL REFERENCES public.visitor_sessions(id) ON DELETE SET NULL,
  conversion_name     TEXT NOT NULL DEFAULT 'lead_form_submit',
  source              TEXT NOT NULL DEFAULT 'form',
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  converted_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_form_conversions_company_time
  ON public.form_conversions(company_id, converted_at DESC);
CREATE INDEX IF NOT EXISTS idx_form_conversions_form_id
  ON public.form_conversions(form_id)
  WHERE form_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.campaign_touchpoints (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  website_id          UUID NULL REFERENCES public.websites(id) ON DELETE SET NULL,
  campaign_id         UUID NULL REFERENCES public.campaigns(id) ON DELETE SET NULL,
  visitor_session_id  UUID NULL REFERENCES public.visitor_sessions(id) ON DELETE SET NULL,
  lead_id             UUID NULL REFERENCES public.leads(id) ON DELETE SET NULL,
  touchpoint_type     TEXT NOT NULL,
  source              TEXT NULL,
  medium              TEXT NULL,
  campaign            TEXT NULL,
  content             TEXT NULL,
  term                TEXT NULL,
  page_url            TEXT NULL,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  touched_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_campaign_touchpoints_company_time
  ON public.campaign_touchpoints(company_id, touched_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaign_touchpoints_campaign
  ON public.campaign_touchpoints(campaign_id)
  WHERE campaign_id IS NOT NULL;

ALTER TABLE public.canonical_events
  ADD COLUMN IF NOT EXISTS website_id UUID NULL REFERENCES public.websites(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS visitor_session_id UUID NULL REFERENCES public.visitor_sessions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_canonical_events_website_timestamp
  ON public.canonical_events(website_id, event_timestamp DESC)
  WHERE website_id IS NOT NULL;

ALTER TABLE public.canonical_conversions
  ADD COLUMN IF NOT EXISTS website_id UUID NULL REFERENCES public.websites(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS visitor_session_id UUID NULL REFERENCES public.visitor_sessions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_canonical_conversions_website_timestamp
  ON public.canonical_conversions(website_id, conversion_timestamp DESC)
  WHERE website_id IS NOT NULL;

ALTER TABLE public.websites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.website_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publishing_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publishing_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visitor_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracking_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_attributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_conversions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_touchpoints ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t TEXT;
  protected_tables TEXT[] := ARRAY[
    'websites',
    'website_connections',
    'integration_credentials',
    'publishing_jobs',
    'publishing_attempts',
    'integration_logs',
    'webhook_events',
    'sync_jobs',
    'visitor_sessions',
    'tracking_events',
    'lead_attributions',
    'form_conversions',
    'campaign_touchpoints'
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
      'CREATE POLICY "service_role_full_access" ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      t
    );
  END LOOP;
END $$;

COMMENT ON TABLE public.websites IS
  'Canonical multi-website entity scoped to a company. Existing relations are nullable until backfill is complete.';
COMMENT ON TABLE public.website_connections IS
  'Provider connections for CMS/blog/tracking integrations, scoped to one website.';
COMMENT ON TABLE public.integration_credentials IS
  'Encrypted provider credentials keyed by website connection. Plaintext credentials must not be persisted.';
COMMENT ON TABLE public.publishing_jobs IS
  'Durable async-ready publishing job queue with idempotency and retry metadata.';
COMMENT ON TABLE public.lead_attributions IS
  'Capture-time attribution snapshots for lead conversions; multi-touch expansion lands in later phases.';

COMMIT;

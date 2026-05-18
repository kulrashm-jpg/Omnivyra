-- Omnivera Website Intelligence - Phase 2 Operational Layer
-- Queue execution, WordPress operational metadata, attribution continuity,
-- website onboarding progress, domain enforcement, analytics summaries,
-- health monitoring, and plugin-ready backend foundation.

BEGIN;

ALTER TABLE public.publishing_jobs
  DROP CONSTRAINT IF EXISTS publishing_jobs_status_check;
ALTER TABLE public.publishing_jobs
  ADD CONSTRAINT publishing_jobs_status_check
    CHECK (status IN (
      'queued','processing','published','failed','retrying','cancelled','dead_letter',
      'scheduled','running','succeeded'
    ));

ALTER TABLE public.publishing_jobs
  ADD COLUMN IF NOT EXISTS run_after TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS locked_by TEXT NULL,
  ADD COLUMN IF NOT EXISTS lock_expires_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS dead_letter_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS execution_duration_ms INTEGER NULL,
  ADD COLUMN IF NOT EXISTS failure_category TEXT NULL,
  ADD COLUMN IF NOT EXISTS provider_response_snapshots JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS metrics JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_publishing_jobs_due_operational
  ON public.publishing_jobs(run_after, created_at)
  WHERE status IN ('queued','retrying','scheduled');
CREATE INDEX IF NOT EXISTS idx_publishing_jobs_lock_expiry
  ON public.publishing_jobs(lock_expires_at)
  WHERE status = 'processing' AND lock_expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_publishing_jobs_dead_letter
  ON public.publishing_jobs(company_id, dead_letter_at DESC)
  WHERE status = 'dead_letter';

ALTER TABLE public.publishing_attempts
  ADD COLUMN IF NOT EXISTS duration_ms INTEGER NULL,
  ADD COLUMN IF NOT EXISTS failure_category TEXT NULL,
  ADD COLUMN IF NOT EXISTS worker_id TEXT NULL;

CREATE TABLE IF NOT EXISTS public.cms_taxonomy_cache (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES public.website_connections(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL,
  taxonomy_type TEXT NOT NULL,
  external_id   TEXT NOT NULL,
  name          TEXT NOT NULL,
  slug          TEXT NULL,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cms_taxonomy_cache_type_check CHECK (taxonomy_type IN ('category','tag','author')),
  CONSTRAINT cms_taxonomy_cache_unique UNIQUE (connection_id, taxonomy_type, external_id)
);
CREATE INDEX IF NOT EXISTS idx_cms_taxonomy_cache_lookup
  ON public.cms_taxonomy_cache(connection_id, taxonomy_type, lower(name));

CREATE TABLE IF NOT EXISTS public.cms_media_assets (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  website_id      UUID NULL REFERENCES public.websites(id) ON DELETE SET NULL,
  connection_id   UUID NULL REFERENCES public.website_connections(id) ON DELETE SET NULL,
  provider        TEXT NOT NULL,
  source_url      TEXT NULL,
  external_id     TEXT NULL,
  external_url    TEXT NULL,
  content_type    TEXT NULL,
  upload_status   TEXT NOT NULL DEFAULT 'uploaded',
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cms_media_assets_status_check CHECK (upload_status IN ('queued','uploaded','failed','cleanup_pending','deleted'))
);
CREATE INDEX IF NOT EXISTS idx_cms_media_assets_connection_source
  ON public.cms_media_assets(connection_id, source_url)
  WHERE connection_id IS NOT NULL AND source_url IS NOT NULL;

ALTER TABLE public.visitor_sessions
  ADD COLUMN IF NOT EXISTS session_key TEXT NULL,
  ADD COLUMN IF NOT EXISTS attribution_window_days INTEGER NOT NULL DEFAULT 90,
  ADD COLUMN IF NOT EXISTS stitched_at TIMESTAMPTZ NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_visitor_sessions_company_anon_session
  ON public.visitor_sessions(company_id, anonymous_id, session_key)
  WHERE company_id IS NOT NULL AND session_key IS NOT NULL;

ALTER TABLE public.tracking_events
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT NULL,
  ADD COLUMN IF NOT EXISTS batch_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS user_agent TEXT NULL,
  ADD COLUMN IF NOT EXISTS ip_hash TEXT NULL,
  ADD COLUMN IF NOT EXISTS bot_flag BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_tracking_events_website_dedupe
  ON public.tracking_events(website_id, dedupe_key)
  WHERE website_id IS NOT NULL AND dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tracking_events_unprocessed
  ON public.tracking_events(website_id, occurred_at)
  WHERE processed_at IS NULL;

CREATE TABLE IF NOT EXISTS public.website_analytics_daily (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  website_id       UUID NOT NULL REFERENCES public.websites(id) ON DELETE CASCADE,
  day              DATE NOT NULL,
  page_views       INTEGER NOT NULL DEFAULT 0,
  unique_visitors  INTEGER NOT NULL DEFAULT 0,
  cta_clicks       INTEGER NOT NULL DEFAULT 0,
  form_starts      INTEGER NOT NULL DEFAULT 0,
  form_submits     INTEGER NOT NULL DEFAULT 0,
  outbound_clicks  INTEGER NOT NULL DEFAULT 0,
  conversions      INTEGER NOT NULL DEFAULT 0,
  source_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT website_analytics_daily_unique UNIQUE (website_id, day)
);

CREATE TABLE IF NOT EXISTS public.page_analytics_daily (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  website_id       UUID NOT NULL REFERENCES public.websites(id) ON DELETE CASCADE,
  day              DATE NOT NULL,
  page_url         TEXT NOT NULL,
  page_views       INTEGER NOT NULL DEFAULT 0,
  unique_visitors  INTEGER NOT NULL DEFAULT 0,
  cta_clicks       INTEGER NOT NULL DEFAULT 0,
  conversions      INTEGER NOT NULL DEFAULT 0,
  avg_scroll_depth INTEGER NULL,
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT page_analytics_daily_unique UNIQUE (website_id, day, page_url)
);

CREATE TABLE IF NOT EXISTS public.campaign_analytics_daily (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  website_id       UUID NULL REFERENCES public.websites(id) ON DELETE SET NULL,
  campaign_key     TEXT NOT NULL,
  day              DATE NOT NULL,
  sessions         INTEGER NOT NULL DEFAULT 0,
  page_views       INTEGER NOT NULL DEFAULT 0,
  cta_clicks       INTEGER NOT NULL DEFAULT 0,
  conversions      INTEGER NOT NULL DEFAULT 0,
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT campaign_analytics_daily_unique UNIQUE (company_id, website_id, campaign_key, day)
);

CREATE TABLE IF NOT EXISTS public.website_setup_progress (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  website_id       UUID NULL REFERENCES public.websites(id) ON DELETE CASCADE,
  current_step     TEXT NOT NULL DEFAULT 'create_website',
  completed_steps  TEXT[] NOT NULL DEFAULT '{}'::text[],
  step_state       JSONB NOT NULL DEFAULT '{}'::jsonb,
  health_summary   JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_error       TEXT NULL,
  created_by       UUID NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT website_setup_progress_step_check CHECK (current_step IN (
    'create_website','verify_domain','select_cms','connect_cms','install_tracking','connect_forms','summary'
  ))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_website_setup_progress_website
  ON public.website_setup_progress(website_id)
  WHERE website_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.integration_health_checks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  website_id       UUID NULL REFERENCES public.websites(id) ON DELETE SET NULL,
  connection_id    UUID NULL REFERENCES public.website_connections(id) ON DELETE SET NULL,
  provider         TEXT NOT NULL,
  check_type       TEXT NOT NULL,
  status           TEXT NOT NULL,
  message          TEXT NULL,
  diagnostics      JSONB NOT NULL DEFAULT '{}'::jsonb,
  checked_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT integration_health_status_check CHECK (status IN ('healthy','warning','degraded','failed','reauth_required'))
);
CREATE INDEX IF NOT EXISTS idx_integration_health_connection_time
  ON public.integration_health_checks(connection_id, checked_at DESC)
  WHERE connection_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.wordpress_plugin_registrations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  website_id       UUID NOT NULL REFERENCES public.websites(id) ON DELETE CASCADE,
  connection_id    UUID NULL REFERENCES public.website_connections(id) ON DELETE SET NULL,
  site_url         TEXT NOT NULL,
  plugin_site_id   TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending',
  auth_nonce_hash  TEXT NULL,
  last_heartbeat_at TIMESTAMPTZ NULL,
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT wordpress_plugin_registrations_status_check CHECK (status IN ('pending','verified','connected','disabled','failed')),
  CONSTRAINT wordpress_plugin_registrations_unique UNIQUE (website_id, plugin_site_id)
);

ALTER TABLE public.website_connections
  DROP CONSTRAINT IF EXISTS website_connections_health_check;
ALTER TABLE public.website_connections
  ADD CONSTRAINT website_connections_health_check
    CHECK (health_status IN ('unknown','healthy','warning','degraded','failed','reauth_required'));

DO $$
DECLARE
  t TEXT;
  protected_tables TEXT[] := ARRAY[
    'cms_taxonomy_cache',
    'cms_media_assets',
    'website_analytics_daily',
    'page_analytics_daily',
    'campaign_analytics_daily',
    'website_setup_progress',
    'integration_health_checks',
    'wordpress_plugin_registrations'
  ];
BEGIN
  FOREACH t IN ARRAY protected_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
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

COMMENT ON TABLE public.website_analytics_daily IS
  'Incremental website-level daily analytics summaries for dashboard readiness.';
COMMENT ON TABLE public.website_setup_progress IS
  'Recoverable guided website onboarding state for the Website Intelligence setup wizard.';
COMMENT ON TABLE public.wordpress_plugin_registrations IS
  'Backend foundation for future WordPress plugin registration and heartbeat auth.';

COMMIT;

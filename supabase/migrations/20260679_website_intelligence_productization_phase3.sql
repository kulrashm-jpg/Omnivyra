-- Omnivera Website Intelligence - Phase 3 Productization Recovery
-- Restores plugin setup/session, reconciliation, audit, queue, and alert tables
-- referenced by the Website Intelligence operational services.

BEGIN;

ALTER TABLE public.wordpress_plugin_registrations
  DROP CONSTRAINT IF EXISTS wordpress_plugin_registrations_status_check;

ALTER TABLE public.wordpress_plugin_registrations
  ADD COLUMN IF NOT EXISTS access_token_hash TEXT NULL,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS token_rotated_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS token_rotation_required_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS revoked_reason TEXT NULL,
  ADD COLUMN IF NOT EXISTS plugin_version TEXT NULL,
  ADD COLUMN IF NOT EXISTS wp_version TEXT NULL,
  ADD COLUMN IF NOT EXISTS php_version TEXT NULL,
  ADD COLUMN IF NOT EXISTS compatibility_status TEXT NULL,
  ADD COLUMN IF NOT EXISTS capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS diagnostics JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS last_event_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ NULL;

ALTER TABLE public.wordpress_plugin_registrations
  ADD CONSTRAINT wordpress_plugin_registrations_status_check
    CHECK (status IN ('pending','verified','connected','disabled','failed','reauth_required','revoked'));

CREATE INDEX IF NOT EXISTS idx_wordpress_plugin_registrations_token
  ON public.wordpress_plugin_registrations(access_token_hash)
  WHERE access_token_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.wordpress_plugin_setup_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  website_id UUID NULL REFERENCES public.websites(id) ON DELETE SET NULL,
  connection_id UUID NULL REFERENCES public.website_connections(id) ON DELETE SET NULL,
  registration_id UUID NULL REFERENCES public.wordpress_plugin_registrations(id) ON DELETE SET NULL,
  setup_token_hash TEXT NOT NULL,
  expected_domain TEXT NULL,
  site_url TEXT NULL,
  plugin_site_id TEXT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  last_error TEXT NULL,
  created_by UUID NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT wordpress_plugin_setup_sessions_status_check
    CHECK (status IN ('pending','connected','failed','expired','revoked'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_wordpress_plugin_setup_sessions_token
  ON public.wordpress_plugin_setup_sessions(setup_token_hash);
CREATE INDEX IF NOT EXISTS idx_wordpress_plugin_setup_sessions_company
  ON public.wordpress_plugin_setup_sessions(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wordpress_plugin_setup_sessions_expires
  ON public.wordpress_plugin_setup_sessions(expires_at)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS public.wordpress_plugin_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  website_id UUID NOT NULL REFERENCES public.websites(id) ON DELETE CASCADE,
  registration_id UUID NOT NULL REFERENCES public.wordpress_plugin_registrations(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  replay_status TEXT NOT NULL DEFAULT 'accepted',
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT wordpress_plugin_events_replay_status_check
    CHECK (replay_status IN ('accepted','duplicate','expired','rejected'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_wordpress_plugin_events_idempotency
  ON public.wordpress_plugin_events(registration_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_wordpress_plugin_events_company_time
  ON public.wordpress_plugin_events(company_id, received_at DESC);

CREATE TABLE IF NOT EXISTS public.wordpress_external_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  website_id UUID NOT NULL REFERENCES public.websites(id) ON DELETE CASCADE,
  registration_id UUID NULL REFERENCES public.wordpress_plugin_registrations(id) ON DELETE SET NULL,
  external_id TEXT NOT NULL,
  title TEXT NULL,
  status TEXT NULL,
  permalink TEXT NULL,
  author_id TEXT NULL,
  taxonomy JSONB NOT NULL DEFAULT '{}'::jsonb,
  media JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  deleted_at TIMESTAMPTZ NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_wordpress_external_posts_website_external
  ON public.wordpress_external_posts(website_id, external_id);

CREATE TABLE IF NOT EXISTS public.wordpress_plugin_debug_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  website_id UUID NOT NULL REFERENCES public.websites(id) ON DELETE CASCADE,
  registration_id UUID NULL REFERENCES public.wordpress_plugin_registrations(id) ON DELETE SET NULL,
  level TEXT NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  logged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT wordpress_plugin_debug_logs_level_check CHECK (level IN ('debug','info','warn','error'))
);

CREATE INDEX IF NOT EXISTS idx_wordpress_plugin_debug_logs_registration
  ON public.wordpress_plugin_debug_logs(registration_id, logged_at DESC);

CREATE TABLE IF NOT EXISTS public.wordpress_sync_cursors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  website_id UUID NOT NULL REFERENCES public.websites(id) ON DELETE CASCADE,
  registration_id UUID NULL REFERENCES public.wordpress_plugin_registrations(id) ON DELETE SET NULL,
  sync_type TEXT NOT NULL,
  cursor_value TEXT NULL,
  last_synced_at TIMESTAMPTZ NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_wordpress_sync_cursors_website_type
  ON public.wordpress_sync_cursors(website_id, sync_type);

CREATE TABLE IF NOT EXISTS public.reconciliation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  website_id UUID NULL REFERENCES public.websites(id) ON DELETE SET NULL,
  publishing_job_id UUID NULL REFERENCES public.publishing_jobs(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  external_id TEXT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  run_after TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ NULL,
  locked_by TEXT NULL,
  lock_expires_at TIMESTAMPTZ NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  last_error TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT reconciliation_jobs_status_check
    CHECK (status IN ('queued','processing','healthy','drifted','missing','duplicate','externally_modified','orphaned','failed','retrying','dead_letter','cancelled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_reconciliation_jobs_company_idempotency
  ON public.reconciliation_jobs(company_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_reconciliation_jobs_due
  ON public.reconciliation_jobs(run_after, created_at)
  WHERE status IN ('queued','retrying');
CREATE INDEX IF NOT EXISTS idx_reconciliation_jobs_company_status
  ON public.reconciliation_jobs(company_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.reconciliation_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_job_id UUID NOT NULL REFERENCES public.reconciliation_jobs(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL,
  status TEXT NOT NULL,
  provider_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  drift_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ NULL,
  duration_ms INTEGER NULL
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_attempts_job
  ON public.reconciliation_attempts(reconciliation_job_id, attempt_number DESC);

CREATE TABLE IF NOT EXISTS public.publish_integrity_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  website_id UUID NULL REFERENCES public.websites(id) ON DELETE SET NULL,
  publishing_job_id UUID NULL REFERENCES public.publishing_jobs(id) ON DELETE SET NULL,
  blog_id UUID NULL REFERENCES public.blogs(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  external_id TEXT NULL,
  external_url TEXT NULL,
  integrity_status TEXT NOT NULL DEFAULT 'healthy',
  last_checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  drift_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  provider_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT publish_integrity_status_check
    CHECK (integrity_status IN ('healthy','drifted','missing','duplicate','externally_modified','orphaned','failed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_publish_integrity_company_job
  ON public.publish_integrity_status(company_id, publishing_job_id)
  WHERE publishing_job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_publish_integrity_company_status
  ON public.publish_integrity_status(company_id, integrity_status, last_checked_at DESC);

CREATE TABLE IF NOT EXISTS public.worker_health (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id TEXT NOT NULL,
  worker_type TEXT NOT NULL,
  queue_name TEXT NULL,
  status TEXT NOT NULL DEFAULT 'healthy',
  heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  concurrency INTEGER NOT NULL DEFAULT 1,
  processed_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT worker_health_status_check CHECK (status IN ('healthy','warning','degraded','failed','stale'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_worker_health_worker_type
  ON public.worker_health(worker_id, worker_type);
CREATE INDEX IF NOT EXISTS idx_worker_health_heartbeat
  ON public.worker_health(heartbeat_at DESC);

CREATE TABLE IF NOT EXISTS public.queue_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_name TEXT NOT NULL,
  company_id UUID NULL REFERENCES public.companies(id) ON DELETE SET NULL,
  website_id UUID NULL REFERENCES public.websites(id) ON DELETE SET NULL,
  metric_window_start TIMESTAMPTZ NOT NULL,
  metric_window_end TIMESTAMPTZ NOT NULL,
  queued_count INTEGER NOT NULL DEFAULT 0,
  processing_count INTEGER NOT NULL DEFAULT 0,
  retrying_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  dead_letter_count INTEGER NOT NULL DEFAULT 0,
  lag_seconds INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_queue_metrics_queue_window
  ON public.queue_metrics(queue_name, metric_window_end DESC);
CREATE INDEX IF NOT EXISTS idx_queue_metrics_company_window
  ON public.queue_metrics(company_id, metric_window_end DESC)
  WHERE company_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NULL REFERENCES public.companies(id) ON DELETE SET NULL,
  website_id UUID NULL REFERENCES public.websites(id) ON DELETE SET NULL,
  actor_user_id UUID NULL,
  actor_type TEXT NOT NULL DEFAULT 'system',
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_hash TEXT NULL,
  user_agent TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT audit_events_actor_type_check CHECK (actor_type IN ('user','system','plugin','worker')),
  CONSTRAINT audit_events_severity_check CHECK (severity IN ('info','warning','critical'))
);

CREATE INDEX IF NOT EXISTS idx_audit_events_company_created
  ON public.audit_events(company_id, created_at DESC)
  WHERE company_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.website_intelligence_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NULL REFERENCES public.companies(id) ON DELETE SET NULL,
  website_id UUID NULL REFERENCES public.websites(id) ON DELETE SET NULL,
  alert_key TEXT NOT NULL,
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning',
  status TEXT NOT NULL DEFAULT 'open',
  message TEXT NOT NULL,
  remediation TEXT NULL,
  routing JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT website_intelligence_alerts_severity_check CHECK (severity IN ('info','warning','critical')),
  CONSTRAINT website_intelligence_alerts_status_check CHECK (status IN ('open','acknowledged','resolved','ignored'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_website_intelligence_alerts_key
  ON public.website_intelligence_alerts(company_id, website_id, alert_key);
CREATE INDEX IF NOT EXISTS idx_website_intelligence_alerts_company_status
  ON public.website_intelligence_alerts(company_id, status, last_seen_at DESC);

DO $$
DECLARE
  t TEXT;
  protected_tables TEXT[] := ARRAY[
    'wordpress_plugin_setup_sessions',
    'wordpress_plugin_events',
    'wordpress_external_posts',
    'wordpress_plugin_debug_logs',
    'wordpress_sync_cursors',
    'reconciliation_jobs',
    'reconciliation_attempts',
    'publish_integrity_status',
    'worker_health',
    'queue_metrics',
    'audit_events',
    'website_intelligence_alerts'
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

COMMIT;

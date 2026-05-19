-- Omnivera Website Intelligence - Phase 5 Validation Stabilization Recovery
-- Adds validation-friendly indexes, lifecycle columns, and readiness metadata.

BEGIN;

ALTER TABLE public.website_connections
  ADD COLUMN IF NOT EXISTS diagnostics JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS reauth_required_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS last_health_check_at TIMESTAMPTZ NULL;

ALTER TABLE public.wordpress_plugin_registrations
  ADD COLUMN IF NOT EXISTS compatibility_report JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS setup_completed_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS reconnect_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_diagnostics_at TIMESTAMPTZ NULL;

ALTER TABLE public.publishing_jobs
  ADD COLUMN IF NOT EXISTS external_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS external_url TEXT NULL,
  ADD COLUMN IF NOT EXISTS reconciliation_status TEXT NULL,
  ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_publishing_jobs_external_lookup
  ON public.publishing_jobs(provider, external_id)
  WHERE external_id IS NOT NULL;

ALTER TABLE public.tracking_events
  ADD COLUMN IF NOT EXISTS ingestion_status TEXT NOT NULL DEFAULT 'accepted',
  ADD COLUMN IF NOT EXISTS rejected_reason TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_tracking_events_ingestion_status
  ON public.tracking_events(ingestion_status, created_at DESC);

ALTER TABLE public.queue_metrics
  ADD COLUMN IF NOT EXISTS worker_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS oldest_job_age_seconds INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.worker_health
  ADD COLUMN IF NOT EXISTS build_version TEXT NULL,
  ADD COLUMN IF NOT EXISTS deployment_id TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_worker_health_queue_status
  ON public.worker_health(queue_name, status, heartbeat_at DESC)
  WHERE queue_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wordpress_plugin_registrations_company_status
  ON public.wordpress_plugin_registrations(company_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_wordpress_plugin_events_type_time
  ON public.wordpress_plugin_events(event_type, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_reconciliation_jobs_lock_expiry
  ON public.reconciliation_jobs(lock_expires_at)
  WHERE status = 'processing' AND lock_expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_publish_integrity_website_status
  ON public.publish_integrity_status(website_id, integrity_status, last_checked_at DESC)
  WHERE website_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_website_intelligence_alerts_type_status
  ON public.website_intelligence_alerts(alert_type, status, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_website_intelligence_signals_type_state
  ON public.website_intelligence_signals(type, resolved_state, generated_at DESC);

ALTER TABLE public.worker_health ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.queue_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wordpress_plugin_setup_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reconciliation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publish_integrity_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.website_intelligence_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.website_intelligence_signals ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.worker_health IS
  'Worker heartbeat and operational status used by Website Intelligence readiness checks.';
COMMENT ON TABLE public.queue_metrics IS
  'Queue lag, retry, and dead-letter measurements for Website Intelligence operations.';
COMMENT ON TABLE public.wordpress_plugin_setup_sessions IS
  'Expiring setup-token sessions used by the WordPress plugin connection flow.';
COMMENT ON TABLE public.reconciliation_jobs IS
  'Durable publishing reconciliation queue for external CMS publish integrity checks.';
COMMENT ON TABLE public.website_intelligence_alerts IS
  'Operational alerts generated from queue, tracking, plugin, and publishing health.';

COMMIT;

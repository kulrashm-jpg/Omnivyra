-- Phase 13 — BOLT Creator Enterprise Reliability Schema
--
-- Adds operational telemetry, immutable audit trail, alert dedup state,
-- and dead-letter queue support tables for the creator workflow.
--
-- All tables are append-mostly (audit/events) or low-cardinality state
-- (alerts/DLQ) and are indexed for the query patterns the observability
-- and admin-dashboard layers use.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1. Operational events (telemetry stream)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS creator_operational_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type      TEXT NOT NULL,
  severity        TEXT NOT NULL DEFAULT 'info',
  trace_id        TEXT,
  correlation_id  TEXT,
  company_id      UUID,
  campaign_id     UUID,
  daily_plan_id   UUID,
  scheduled_post_id UUID,
  actor_user_id   UUID,
  creator_format  TEXT,
  lifecycle_state TEXT,
  execution_mode  TEXT,
  worker_id       TEXT,
  queue_job_id    UUID,
  retry_count     INTEGER,
  latency_ms      INTEGER,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_creator_events_type_time
  ON creator_operational_events (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_creator_events_company_time
  ON creator_operational_events (company_id, created_at DESC)
  WHERE company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_creator_events_trace
  ON creator_operational_events (trace_id)
  WHERE trace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_creator_events_post
  ON creator_operational_events (scheduled_post_id)
  WHERE scheduled_post_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_creator_events_plan
  ON creator_operational_events (daily_plan_id)
  WHERE daily_plan_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Immutable audit log
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS creator_audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action          TEXT NOT NULL,
  actor_user_id   UUID,
  actor_kind      TEXT NOT NULL DEFAULT 'user',  -- user | system | cron | worker
  daily_plan_id   UUID,
  scheduled_post_id UUID,
  campaign_id     UUID,
  company_id      UUID,
  source          TEXT NOT NULL DEFAULT 'api',
  correlation_id  TEXT,
  trace_id        TEXT,
  previous_state  JSONB,
  new_state       JSONB,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_creator_audit_action_time
  ON creator_audit_log (action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_creator_audit_plan
  ON creator_audit_log (daily_plan_id, created_at DESC)
  WHERE daily_plan_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_creator_audit_post
  ON creator_audit_log (scheduled_post_id, created_at DESC)
  WHERE scheduled_post_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_creator_audit_company
  ON creator_audit_log (company_id, created_at DESC)
  WHERE company_id IS NOT NULL;

-- Append-only enforcement: deny UPDATE / DELETE on audit log.
-- Single trigger that rejects either operation with a structured error.
CREATE OR REPLACE FUNCTION creator_audit_log_immutable()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'creator_audit_log is append-only (operation: %)', TG_OP
    USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_creator_audit_log_no_update ON creator_audit_log;
CREATE TRIGGER trg_creator_audit_log_no_update
  BEFORE UPDATE OR DELETE ON creator_audit_log
  FOR EACH ROW EXECUTE FUNCTION creator_audit_log_immutable();

-- ─────────────────────────────────────────────────────────────────────
-- 3. Alert state (deduplication + cooldown)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS creator_alert_state (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_key       TEXT NOT NULL UNIQUE,
  severity        TEXT NOT NULL DEFAULT 'warning',
  message         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active', -- active | acknowledged | resolved
  fire_count      INTEGER NOT NULL DEFAULT 1,
  first_fired_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_fired_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_notified_at TIMESTAMPTZ,
  cooldown_until  TIMESTAMPTZ,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolved_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_creator_alerts_status_severity
  ON creator_alert_state (status, severity, last_fired_at DESC);
CREATE INDEX IF NOT EXISTS idx_creator_alerts_cooldown
  ON creator_alert_state (cooldown_until)
  WHERE cooldown_until IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────
-- 4. Dead-letter queue for poisoned scheduled-post publish jobs
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS creator_dead_letter_jobs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scheduled_post_id UUID NOT NULL,
  queue_job_id      UUID,
  failure_count     INTEGER NOT NULL DEFAULT 0,
  last_error_code   TEXT,
  last_error_message TEXT,
  first_failed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_failed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status            TEXT NOT NULL DEFAULT 'poisoned', -- poisoned | retired | recovered
  poisoned_reason   TEXT,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_creator_dlq_post
  ON creator_dead_letter_jobs (scheduled_post_id);
CREATE INDEX IF NOT EXISTS idx_creator_dlq_status_time
  ON creator_dead_letter_jobs (status, last_failed_at DESC);

-- ─────────────────────────────────────────────────────────────────────
-- 5. Cron singleton lease table (process-level lock for distributed cron)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS creator_cron_lease (
  job_name        TEXT PRIMARY KEY,
  holder_id       TEXT NOT NULL,
  acquired_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL,
  last_heartbeat  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  run_count       INTEGER NOT NULL DEFAULT 0,
  last_status     TEXT,
  last_error      TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_creator_cron_lease_expiry
  ON creator_cron_lease (expires_at);

-- ─────────────────────────────────────────────────────────────────────
-- 6. Upload rate-limiting state (per-user + per-company sliding window)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS creator_upload_rate_state (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope           TEXT NOT NULL,           -- 'user' | 'company' | 'plan'
  scope_id        TEXT NOT NULL,
  bucket_start    TIMESTAMPTZ NOT NULL,
  bucket_size_seconds INTEGER NOT NULL,
  attempt_count   INTEGER NOT NULL DEFAULT 0,
  byte_total      BIGINT NOT NULL DEFAULT 0,
  spoof_count     INTEGER NOT NULL DEFAULT 0,
  failure_count   INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_creator_rate_scope_bucket
  ON creator_upload_rate_state (scope, scope_id, bucket_start);
CREATE INDEX IF NOT EXISTS idx_creator_rate_recent
  ON creator_upload_rate_state (last_attempt_at DESC);

COMMIT;

-- Anomaly detection events table.
--
-- Persists all threshold-crossing anomalies detected by the anomaly detection
-- engine (lib/anomaly/detectionEngine.ts). Separate from auth_audit_logs
-- because anomalies are aggregated/derived signals, not raw identity events.
--
-- Severities:
--   CRITICAL — immediate alert sent (Redis failure, ghost-session spike, etc.)
--   WARNING  — aggregated into hourly digest (rate-limit spikes, domain failures)
--   INFO     — dashboard only (growth trends, normal patterns)
--
-- Entity types:
--   user     — anomaly tied to a specific user account
--   company  — anomaly tied to a company (domain failures, access attempts)
--   system   — infrastructure-level anomaly (Redis, auth service, APIs)

CREATE TABLE IF NOT EXISTS system_anomalies (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  type         TEXT        NOT NULL,
  severity     TEXT        NOT NULL CHECK (severity IN ('CRITICAL', 'WARNING', 'INFO')),
  entity_type  TEXT        NOT NULL CHECK (entity_type IN ('user', 'company', 'system')),
  entity_id    TEXT,
  metric_value NUMERIC,    -- observed value that crossed the threshold
  threshold    NUMERIC,    -- threshold that was used (dynamic, not hardcoded)
  baseline     NUMERIC,    -- baseline at the time of detection (for audit trail)
  metadata     JSONB,
  alerted_at   TIMESTAMPTZ,-- when a notification was dispatched (NULL = not yet sent)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fast lookups for the dashboard and deduplication queries
CREATE INDEX IF NOT EXISTS idx_system_anomalies_severity_time
  ON system_anomalies (severity, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_system_anomalies_type_time
  ON system_anomalies (type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_system_anomalies_entity
  ON system_anomalies (entity_type, entity_id, created_at DESC)
  WHERE entity_id IS NOT NULL;

COMMENT ON TABLE system_anomalies IS
  'Derived anomaly signals from the detection engine. '
  'Do not UPDATE or DELETE rows — they form the audit trail. '
  'Retention: minimum 30 days. Owner: platform-sre.';

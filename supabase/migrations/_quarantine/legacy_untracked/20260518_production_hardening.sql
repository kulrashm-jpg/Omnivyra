-- =============================================================================
-- Phase 7 — Production Hardening
--
-- Two tables to support org-level runtime controls and the operator alerting
-- surface:
--   1. org_controls   — per-org block / daily-credit-limit / high-risk flag
--   2. alerts         — operator-facing fan-out from cost_anomalies + weekly job
-- =============================================================================

-- ───────────────────────────────────────────────────────────────────────────
-- 1. org_controls
--    One row per org; upsert target. Fields default to permissive (no block,
--    no limit, not high-risk) so rolling out doesn't accidentally gate
--    existing orgs. Writes are super-admin-only via the API layer.
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS org_controls (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid        NOT NULL UNIQUE,

  is_blocked            boolean     NOT NULL DEFAULT false,
  blocked_reason        text,
  blocked_by_user_id    uuid,
  blocked_at            timestamptz,

  is_high_risk          boolean     NOT NULL DEFAULT false,
  high_risk_reason      text,
  high_risk_set_at      timestamptz,

  daily_credit_limit    integer     CHECK (daily_credit_limit IS NULL OR daily_credit_limit > 0),

  notes                 text,
  updated_by_user_id    uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_controls_blocked
  ON org_controls (organization_id)
  WHERE is_blocked = true;
CREATE INDEX IF NOT EXISTS idx_org_controls_high_risk
  ON org_controls (organization_id)
  WHERE is_high_risk = true;

CREATE OR REPLACE FUNCTION update_org_controls_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_org_controls_updated_at ON org_controls;
CREATE TRIGGER trg_org_controls_updated_at
  BEFORE UPDATE ON org_controls
  FOR EACH ROW EXECUTE FUNCTION update_org_controls_timestamp();

ALTER TABLE org_controls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_controls_service_all ON org_controls;
CREATE POLICY org_controls_service_all ON org_controls
  FOR ALL USING (auth.role() = 'service_role');

-- ───────────────────────────────────────────────────────────────────────────
-- 2. alerts — operator fan-out
--    cost_anomalies is the raw data layer; alerts is the acknowledgeable
--    queue that humans work from. Not a 1:1 mapping — e.g. multiple leak
--    anomalies in one weekly run collapse into one alert if we want, and
--    some alerts (org_blocked) have no corresponding cost_anomalies row.
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alerts (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  type                text        NOT NULL
                                  CHECK (type IN (
                                    'high_cost',
                                    'negative_margin',
                                    'leak_detected',
                                    'org_blocked',
                                    'pricing_missing',
                                    'weekly_over_limit'
                                  )),
  organization_id     uuid,
  severity            text        NOT NULL DEFAULT 'warn'
                                  CHECK (severity IN ('info', 'warn', 'critical')),
  message             text        NOT NULL,
  metadata            jsonb       NOT NULL DEFAULT '{}'::jsonb,

  acknowledged        boolean     NOT NULL DEFAULT false,
  acknowledged_by     uuid,
  acknowledged_at     timestamptz,

  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alerts_open
  ON alerts (created_at DESC)
  WHERE acknowledged = false;
CREATE INDEX IF NOT EXISTS idx_alerts_org_open
  ON alerts (organization_id, created_at DESC)
  WHERE acknowledged = false;
CREATE INDEX IF NOT EXISTS idx_alerts_type_severity
  ON alerts (type, severity, created_at DESC);

ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS alerts_service_all ON alerts;
CREATE POLICY alerts_service_all ON alerts
  FOR ALL USING (auth.role() = 'service_role');

-- =============================================================================
-- Phase 6 — Pricing Intelligence + Margin Optimization
--
-- Adds the advisory layer that reads the unified ledger, computes per
-- (action_key, model_name, week) margin, recommends multiplier adjustments,
-- detects structural leaks, and queues SAFE-MODE proposed changes.
--
-- Tables:
--   1. pricing_intelligence       — per (action, model, week) margin snapshot
--   2. pricing_adjustment_queue   — proposed multiplier changes awaiting admin review
--
-- Views:
--   3. pricing_health_view        — per-action risk rollup
--
-- cost_anomalies CHECK extended to include 'structural_leak'.
-- =============================================================================

-- ───────────────────────────────────────────────────────────────────────────
-- 1. pricing_intelligence
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pricing_intelligence (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  action_key               text        NOT NULL,
  model_name               text,                               -- null = aggregate across models
  week_start               date        NOT NULL,               -- ISO week Monday

  total_api_cost_usd       numeric(20, 10) NOT NULL DEFAULT 0,
  total_credits_value_usd  numeric(20, 10) NOT NULL DEFAULT 0,
  margin_usd               numeric(20, 10) NOT NULL DEFAULT 0,
  margin_percent           numeric(10, 6),                     -- null = no-credit rows only (can't compute)

  current_multiplier       numeric(10, 4) NOT NULL DEFAULT 1.0,
  recommended_multiplier   numeric(10, 4),                     -- null when no adjustment warranted
  deviation_flag           boolean     NOT NULL DEFAULT false,

  event_count              integer     NOT NULL DEFAULT 0,
  created_at               timestamptz NOT NULL DEFAULT now(),

  UNIQUE (action_key, model_name, week_start)
);

CREATE INDEX IF NOT EXISTS idx_pricing_intel_week
  ON pricing_intelligence (week_start DESC);
CREATE INDEX IF NOT EXISTS idx_pricing_intel_deviation
  ON pricing_intelligence (action_key, week_start DESC)
  WHERE deviation_flag = true;
CREATE INDEX IF NOT EXISTS idx_pricing_intel_action
  ON pricing_intelligence (action_key, week_start DESC);

ALTER TABLE pricing_intelligence ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pricing_intelligence_service_all ON pricing_intelligence;
CREATE POLICY pricing_intelligence_service_all ON pricing_intelligence
  FOR ALL USING (auth.role() = 'service_role');

-- ───────────────────────────────────────────────────────────────────────────
-- 2. pricing_adjustment_queue — SAFE-MODE proposed changes
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pricing_adjustment_queue (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  action_key           text        NOT NULL,
  model_name           text,                                  -- null = applies across all models
  current_multiplier   numeric(10, 4) NOT NULL,
  proposed_multiplier  numeric(10, 4) NOT NULL CHECK (proposed_multiplier >= 0),
  margin_percent       numeric(10, 6),
  reason               text        NOT NULL,                  -- human-readable rationale
  status               text        NOT NULL DEFAULT 'pending'
                                   CHECK (status IN ('pending', 'approved', 'rejected', 'applied', 'superseded')),
  source_week          date,                                  -- which pricing_intelligence row produced this
  reviewed_by_user_id  uuid,
  reviewed_at          timestamptz,
  applied_at           timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- At most one pending proposal per (action, model) — a newer proposal
-- supersedes the older one (job explicitly marks old as 'superseded').
CREATE UNIQUE INDEX IF NOT EXISTS uq_pricing_queue_pending
  ON pricing_adjustment_queue (action_key, COALESCE(model_name, '__all__'))
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_pricing_queue_status
  ON pricing_adjustment_queue (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pricing_queue_action
  ON pricing_adjustment_queue (action_key, created_at DESC);

ALTER TABLE pricing_adjustment_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pricing_adjustment_queue_service_all ON pricing_adjustment_queue;
CREATE POLICY pricing_adjustment_queue_service_all ON pricing_adjustment_queue
  FOR ALL USING (auth.role() = 'service_role');

-- ───────────────────────────────────────────────────────────────────────────
-- 3. pricing_health_view — per-action risk rollup (last 4 weeks)
--    Averages margin across models and recent weeks, assigns risk_level via
--    the TARGET_MIN / TARGET_MAX bounds defined in code.
-- ───────────────────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS pricing_health_view;
CREATE VIEW pricing_health_view AS
WITH recent AS (
  SELECT *
    FROM pricing_intelligence
   WHERE week_start >= (CURRENT_DATE - INTERVAL '28 days')
),
per_action AS (
  SELECT
    action_key,
    AVG(margin_percent) FILTER (WHERE margin_percent IS NOT NULL) AS avg_margin_percent,
    SUM(total_api_cost_usd)                                       AS total_cost,
    SUM(total_credits_value_usd)                                  AS total_credits,
    COUNT(*)                                                      AS weeks_observed,
    BOOL_OR(deviation_flag)                                       AS any_deviation
  FROM recent
  GROUP BY action_key
)
SELECT
  action_key,
  avg_margin_percent,
  total_cost,
  total_credits,
  weeks_observed,
  any_deviation,
  CASE
    -- HIGH: severely out of band (>10pp from either bound) OR persistent deviation
    WHEN avg_margin_percent IS NULL                                       THEN 'low'
    WHEN avg_margin_percent < 0.10  OR avg_margin_percent > 0.70          THEN 'high'
    WHEN avg_margin_percent < 0.20  OR avg_margin_percent > 0.60          THEN 'medium'
    ELSE 'low'
  END AS risk_level
FROM per_action;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. Extend cost_anomalies.anomaly_type CHECK to include 'structural_leak'.
--    Needs the DO-block pattern since we're re-creating an existing CHECK.
-- ───────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'cost_anomalies_anomaly_type_check'
       AND conrelid = 'cost_anomalies'::regclass
  ) THEN
    ALTER TABLE cost_anomalies DROP CONSTRAINT cost_anomalies_anomaly_type_check;
  END IF;
END$$;

ALTER TABLE cost_anomalies
  ADD CONSTRAINT cost_anomalies_anomaly_type_check
  CHECK (anomaly_type IN (
    'pricing_missing',
    'cost_exceeds_request_threshold',
    'cost_exceeds_weekly_limit',
    'cost_credit_mismatch',
    'unknown_action_key',
    'structural_leak'
  ));

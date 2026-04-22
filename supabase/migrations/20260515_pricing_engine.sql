-- =============================================================================
-- Phase 4 — Dynamic Pricing Engine
--
-- Replaces hardcoded PROVIDER_PRICING / EMBEDDING_PRICING constants with DB-
-- backed, versioned pricing rows. Adds margin control via per-action
-- cost_multiplier and per-request + weekly cost guardrails.
--
-- Tables:
--   1. llm_model_pricing       — per-(provider, model) token rates, versioned
--   2. action_pricing_config   — per-action credit_cost override + cost_multiplier
--   3. cost_anomalies          — request-level + org-level guardrail hits
--   4. org_weekly_metrics      — rollups from runWeeklyPricingAnalysis()
--
-- Schema adds:
--   usage_events.action_key text — resolved CreditAction code at log time
-- =============================================================================

-- ───────────────────────────────────────────────────────────────────────────
-- 1. llm_model_pricing
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS llm_model_pricing (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider          text        NOT NULL,                -- 'openai' | 'anthropic' | …
  model_name        text        NOT NULL,
  kind              text        NOT NULL DEFAULT 'completion'
                                CHECK (kind IN ('completion', 'embedding')),
  -- For completion: input/output per 1k. For embedding: input_per_1k_usd only; output is 0.
  input_per_1k_usd  numeric(20, 10) NOT NULL CHECK (input_per_1k_usd >= 0),
  output_per_1k_usd numeric(20, 10) NOT NULL DEFAULT 0 CHECK (output_per_1k_usd >= 0),
  effective_from    timestamptz NOT NULL DEFAULT now(),
  is_active         boolean     NOT NULL DEFAULT true,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Only one active row per (provider, model, kind) can be effective at a time.
-- Partial unique index lets us track history while enforcing a single current row.
CREATE UNIQUE INDEX IF NOT EXISTS uq_llm_model_pricing_active
  ON llm_model_pricing (provider, model_name, kind)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_llm_model_pricing_effective
  ON llm_model_pricing (provider, model_name, kind, effective_from DESC);

ALTER TABLE llm_model_pricing ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS llm_model_pricing_service_all ON llm_model_pricing;
CREATE POLICY llm_model_pricing_service_all ON llm_model_pricing
  FOR ALL USING (auth.role() = 'service_role');

-- Seed with the current hardcoded rates from usageLedgerService so the cutover
-- is seamless. ON CONFLICT DO NOTHING → safe on re-run; new rates go via the
-- admin API as fresh versioned rows (is_active=true on the new, false on old).
INSERT INTO llm_model_pricing (provider, model_name, kind, input_per_1k_usd, output_per_1k_usd, notes)
VALUES
  ('openai',    'gpt-4o-mini',              'completion', 0.0003,    0.0006,  'seeded from code'),
  ('openai',    'gpt-4o',                   'completion', 0.005,     0.015,   'seeded from code'),
  ('anthropic', 'claude-3-5-sonnet',        'completion', 0.003,     0.015,   'seeded from code'),
  ('openai',    'text-embedding-3-small',   'embedding',  0.00002,   0,       'seeded from code'),
  ('openai',    'text-embedding-3-large',   'embedding',  0.00013,   0,       'seeded from code'),
  ('openai',    'text-embedding-ada-002',   'embedding',  0.00010,   0,       'seeded from code')
ON CONFLICT DO NOTHING;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. action_pricing_config
--    Layered on top of the existing credit_cost_config table. credit_cost here
--    is an OPTIONAL override; if null, the lookup falls through to
--    credit_cost_config. cost_multiplier applies in both cases (margin knob).
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS action_pricing_config (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  action_key       text        NOT NULL,        -- must match a CreditAction
  credit_cost      integer     CHECK (credit_cost IS NULL OR credit_cost >= 0),
  cost_multiplier  numeric(10, 4) NOT NULL DEFAULT 1.0 CHECK (cost_multiplier >= 0),
  effective_from   timestamptz NOT NULL DEFAULT now(),
  is_active        boolean     NOT NULL DEFAULT true,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_action_pricing_config_active
  ON action_pricing_config (action_key)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_action_pricing_config_effective
  ON action_pricing_config (action_key, effective_from DESC);

ALTER TABLE action_pricing_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS action_pricing_config_service_all ON action_pricing_config;
CREATE POLICY action_pricing_config_service_all ON action_pricing_config
  FOR ALL USING (auth.role() = 'service_role');

-- ───────────────────────────────────────────────────────────────────────────
-- 3. cost_anomalies — guardrail-hit log (request + org level)
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cost_anomalies (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,                                   -- nullable for global anomalies
  anomaly_type    text        NOT NULL
                              CHECK (anomaly_type IN (
                                'pricing_missing',
                                'cost_exceeds_request_threshold',
                                'cost_exceeds_weekly_limit',
                                'cost_credit_mismatch',
                                'unknown_action_key'
                              )),
  severity        text        NOT NULL DEFAULT 'warn'
                              CHECK (severity IN ('info', 'warn', 'critical')),
  api_cost_usd    numeric(20, 10),
  credits_value_usd numeric(20, 10),
  process_type    text,
  action_key      text,
  model_name      text,
  detected_at     timestamptz NOT NULL DEFAULT now(),
  metadata        jsonb       NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_cost_anomalies_org_time
  ON cost_anomalies (organization_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_cost_anomalies_type
  ON cost_anomalies (anomaly_type, detected_at DESC);

ALTER TABLE cost_anomalies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cost_anomalies_service_all ON cost_anomalies;
CREATE POLICY cost_anomalies_service_all ON cost_anomalies
  FOR ALL USING (auth.role() = 'service_role');

-- ───────────────────────────────────────────────────────────────────────────
-- 4. org_weekly_metrics — weekly pricing-analysis rollups
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS org_weekly_metrics (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid        NOT NULL,
  week_start          date        NOT NULL,               -- ISO week Monday
  total_api_cost_usd  numeric(20, 10) NOT NULL DEFAULT 0,
  total_credits_used  integer     NOT NULL DEFAULT 0,
  credits_value_usd   numeric(20, 10) NOT NULL DEFAULT 0,
  margin_usd          numeric(20, 10) NOT NULL DEFAULT 0, -- credits_value - api_cost
  is_negative_margin  boolean     NOT NULL DEFAULT false,
  is_cost_spike       boolean     NOT NULL DEFAULT false, -- 2x week-over-week
  top_action_key      text,
  top_action_cost_usd numeric(20, 10),
  breakdown           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  computed_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_org_weekly_metrics_week
  ON org_weekly_metrics (week_start DESC);
CREATE INDEX IF NOT EXISTS idx_org_weekly_metrics_neg_margin
  ON org_weekly_metrics (organization_id, week_start DESC)
  WHERE is_negative_margin = true;

ALTER TABLE org_weekly_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_weekly_metrics_service_all ON org_weekly_metrics;
CREATE POLICY org_weekly_metrics_service_all ON org_weekly_metrics
  FOR ALL USING (auth.role() = 'service_role');

-- ───────────────────────────────────────────────────────────────────────────
-- 5. usage_events.action_key — resolved CreditAction at log time
--    Stored as a real column for efficient filtering; computed via
--    resolveActionKey(process_type). Null is allowed (unknown process_type
--    surfaces as a cost_anomalies row, not a blocked request).
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE usage_events
  ADD COLUMN IF NOT EXISTS action_key text;

CREATE INDEX IF NOT EXISTS idx_usage_events_action_key
  ON usage_events (action_key)
  WHERE action_key IS NOT NULL;

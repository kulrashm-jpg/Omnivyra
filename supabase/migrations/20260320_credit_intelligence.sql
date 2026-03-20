-- ─────────────────────────────────────────────────────────────────────────────
-- Credit Intelligence Layer
-- DB-driven cost config, usage log, revenue metrics.
-- Extends the existing organization_credits / credit_transactions system.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Step 2: credit_cost_config — DB-driven credit costs per action ────────────
-- Overrides the hardcoded CREDIT_COSTS map in creditDeductionService.ts.
-- Super admin can tune without a deployment.
CREATE TABLE IF NOT EXISTS credit_cost_config (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type text NOT NULL UNIQUE,
  credits     int  NOT NULL CHECK (credits >= 0),
  category    text NOT NULL DEFAULT 'medium' CHECK (category IN ('low', 'medium', 'high', 'heavy')),
  description text NOT NULL DEFAULT '',
  smart_dedup_seconds int NOT NULL DEFAULT 0,  -- 0 = no dedup
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Seed all action types (matches CREDIT_COSTS + new Phase 4-6 actions)
INSERT INTO credit_cost_config (action_type, credits, category, description, smart_dedup_seconds) VALUES
  -- Existing (preserve parity with hardcoded map)
  ('ai_reply',               1,  'low',    'AI reply suggestion',                  0),
  ('auto_post',              2,  'low',    'Social auto-post',                     0),
  ('content_rewrite',        3,  'low',    'Content rewrite',                      0),
  ('content_basic',          5,  'low',    'Basic content generation',             0),
  ('trend_analysis',         25, 'medium', 'Trend analysis',                       3600),
  ('market_insight_manual',  30, 'medium', 'Market insight (manual)',              0),
  ('campaign_creation',      40, 'medium', 'Campaign creation',                    0),
  ('website_audit',          50, 'medium', 'Website audit',                        86400),
  ('lead_detection',         15, 'high',   'Lead signal detection (value-gated)',  21600),
  ('daily_insight_scan',     20, 'high',   'Daily insight scan (value-gated)',     86400),
  ('campaign_optimization',  30, 'high',   'Campaign optimisation scan',           43200),
  ('voice_per_minute',       10, 'heavy',  'Voice interaction per minute',         0),
  ('deep_analysis',          60, 'heavy',  'Deep multi-step analysis',             0),
  ('full_strategy',          80, 'heavy',  'Full campaign strategy',               0),
  -- Phase 4-6 action types (NEW)
  ('campaign_generation',    50, 'heavy',  'Autonomous campaign generation',        0),
  ('prediction',             10, 'medium', 'Campaign outcome prediction',           0),
  ('optimization_loop',      15, 'high',   'Live optimization loop iteration',      0),
  ('reply_generation',        2, 'low',    'Community reply generation',            0),
  ('insight_generation',      8, 'medium', 'Intelligence insight generation',       3600),
  ('pattern_detection',      12, 'medium', 'Pattern detection sweep',              86400),
  ('market_positioning',     10, 'medium', 'Market positioning evaluation',        86400),
  ('portfolio_decision',     20, 'high',   'Portfolio multi-campaign rebalancing',  43200),
  ('strategy_evolution',     15, 'high',   'Strategy evolution computation',        86400),
  ('competitor_signals',      8, 'medium', 'Competitor intelligence fetch',         21600)
ON CONFLICT (action_type) DO UPDATE SET
  credits     = EXCLUDED.credits,
  description = EXCLUDED.description,
  updated_at  = now();

ALTER TABLE credit_cost_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON credit_cost_config
  FOR ALL USING (auth.role() = 'service_role');

-- ── Step 10: revenue_metrics — aggregated cost vs revenue per org ─────────────
CREATE TABLE IF NOT EXISTS revenue_metrics (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL,
  period_year           int  NOT NULL,
  period_month          int  NOT NULL,
  credits_consumed      int  NOT NULL DEFAULT 0,
  credits_purchased     int  NOT NULL DEFAULT 0,
  usd_revenue           float NOT NULL DEFAULT 0,   -- from credit purchases
  estimated_llm_cost_usd float NOT NULL DEFAULT 0,  -- compute cost
  gross_margin_usd      float NOT NULL DEFAULT 0,   -- revenue - compute cost
  top_action_type       text,
  top_action_credits    int  NOT NULL DEFAULT 0,
  action_breakdown      jsonb NOT NULL DEFAULT '{}',
  computed_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, period_year, period_month)
);

CREATE INDEX IF NOT EXISTS revenue_metrics_org_period_idx ON revenue_metrics(organization_id, period_year DESC, period_month DESC);
CREATE INDEX IF NOT EXISTS revenue_metrics_period_idx ON revenue_metrics(period_year DESC, period_month DESC);

ALTER TABLE revenue_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON revenue_metrics
  FOR ALL USING (auth.role() = 'service_role');

-- ── Low-credit alert log — avoids repeat notifications ───────────────────────
CREATE TABLE IF NOT EXISTS credit_alert_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  alert_type      text NOT NULL CHECK (alert_type IN ('low_20pct', 'low_10pct', 'depleted', 'auto_topup')),
  balance_at_alert int  NOT NULL,
  notified_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS credit_alert_log_org_idx ON credit_alert_log(organization_id, notified_at DESC);
ALTER TABLE credit_alert_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON credit_alert_log FOR ALL USING (auth.role() = 'service_role');

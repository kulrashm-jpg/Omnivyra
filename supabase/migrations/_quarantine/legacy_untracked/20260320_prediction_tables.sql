-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 4 — Predictive Intelligence
-- Tables for campaign outcome prediction and accuracy tracking.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. campaign_predictions — stores predicted outcomes before campaign execution
CREATE TABLE IF NOT EXISTS campaign_predictions (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id               uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  predicted_engagement_rate float NOT NULL DEFAULT 0,
  predicted_reach           int   NOT NULL DEFAULT 0,
  predicted_leads           int   NOT NULL DEFAULT 0,
  confidence_score          float NOT NULL DEFAULT 0,
  platform_breakdown        jsonb NOT NULL DEFAULT '{}',
  content_type_breakdown    jsonb NOT NULL DEFAULT '{}',
  feature_vector            jsonb NOT NULL DEFAULT '{}',
  optimization_applied      boolean NOT NULL DEFAULT false,
  optimization_rounds       int   NOT NULL DEFAULT 0,
  warnings                  text[] NOT NULL DEFAULT '{}',
  created_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS campaign_predictions_campaign_id_idx ON campaign_predictions(campaign_id);
CREATE INDEX IF NOT EXISTS campaign_predictions_created_at_idx ON campaign_predictions(created_at DESC);

-- RLS
ALTER TABLE campaign_predictions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON campaign_predictions
  FOR ALL USING (auth.role() = 'service_role');

-- 2. prediction_accuracy_log — tracks predicted vs actual after campaign ends
CREATE TABLE IF NOT EXISTS prediction_accuracy_log (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id                 uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  prediction_id               uuid NOT NULL REFERENCES campaign_predictions(id) ON DELETE CASCADE,
  predicted_engagement_rate   float NOT NULL,
  actual_engagement_rate      float NOT NULL,
  predicted_reach             int   NOT NULL,
  actual_reach                int   NOT NULL,
  predicted_leads             int   NOT NULL,
  actual_leads                int   NOT NULL,
  engagement_delta            float NOT NULL,  -- actual - predicted
  reach_delta                 int   NOT NULL,
  leads_delta                 int   NOT NULL,
  accuracy_score              float NOT NULL,  -- 0–1 (1 = perfect)
  evaluated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS prediction_accuracy_log_campaign_id_idx ON prediction_accuracy_log(campaign_id);
CREATE INDEX IF NOT EXISTS prediction_accuracy_log_evaluated_at_idx ON prediction_accuracy_log(evaluated_at DESC);

ALTER TABLE prediction_accuracy_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON prediction_accuracy_log
  FOR ALL USING (auth.role() = 'service_role');

-- 3. prediction_config — admin-tunable prediction thresholds and weights
CREATE TABLE IF NOT EXISTS prediction_config (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  min_confidence_threshold   float NOT NULL DEFAULT 0.5,
  min_engagement_threshold   float NOT NULL DEFAULT 0.02,
  max_optimization_rounds    int   NOT NULL DEFAULT 3,
  weight_hook_strength       float NOT NULL DEFAULT 0.25,
  weight_platform_fit        float NOT NULL DEFAULT 0.20,
  weight_readability         float NOT NULL DEFAULT 0.15,
  weight_authority           float NOT NULL DEFAULT 0.15,
  weight_historical          float NOT NULL DEFAULT 0.25,
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

-- Single-row config — seed defaults
INSERT INTO prediction_config (
  min_confidence_threshold, min_engagement_threshold, max_optimization_rounds,
  weight_hook_strength, weight_platform_fit, weight_readability,
  weight_authority, weight_historical
) VALUES (0.5, 0.02, 3, 0.25, 0.20, 0.15, 0.15, 0.25)
ON CONFLICT DO NOTHING;

ALTER TABLE prediction_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON prediction_config
  FOR ALL USING (auth.role() = 'service_role');

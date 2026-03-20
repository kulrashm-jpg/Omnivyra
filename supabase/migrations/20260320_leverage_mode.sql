-- ─────────────────────────────────────────────────────────────────────────────
-- Leverage Mode — Outcome-based optimization layer
-- Tracks real business outcomes per campaign and per content type,
-- powers credits_per_outcome KPI and efficiency discounts.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. campaign_outcomes — actual business results per campaign
CREATE TABLE IF NOT EXISTS campaign_outcomes (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id           uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  company_id            uuid NOT NULL,
  leads_generated       int  NOT NULL DEFAULT 0,
  conversion_count      int  NOT NULL DEFAULT 0,
  -- Engagement quality: weighted score (comments × 3 + shares × 2 + clicks × 1) / impressions
  engagement_quality    float NOT NULL DEFAULT 0,
  -- Sentiment shift: delta from baseline sentiment (-1 to +1)
  sentiment_shift       float NOT NULL DEFAULT 0,
  -- Composite outcome score (0–100): leads×40 + conversions×35 + quality×15 + sentiment×10
  outcome_score         float NOT NULL DEFAULT 0,
  -- Credits billed during this campaign
  credits_used          int  NOT NULL DEFAULT 0,
  -- North-star: credits spent per unit of outcome (lower = better)
  credits_per_outcome   float NOT NULL DEFAULT 0,
  -- Top performing content type during this campaign
  top_content_type      text,
  -- Credits saved by Smart Mode dedup + fail-fast during this campaign
  credits_saved         int  NOT NULL DEFAULT 0,
  snapshot_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id)
);

CREATE INDEX IF NOT EXISTS campaign_outcomes_company_id_idx ON campaign_outcomes(company_id, snapshot_at DESC);
CREATE INDEX IF NOT EXISTS campaign_outcomes_credits_per_outcome_idx ON campaign_outcomes(credits_per_outcome ASC);

ALTER TABLE campaign_outcomes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON campaign_outcomes
  FOR ALL USING (auth.role() = 'service_role');

-- 2. content_type_efficiency — per company+content_type ROI history
CREATE TABLE IF NOT EXISTS content_type_efficiency (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL,
  content_type          text NOT NULL,
  platform              text NOT NULL DEFAULT 'all',
  avg_outcome_score     float NOT NULL DEFAULT 0,
  avg_credits_per_outcome float NOT NULL DEFAULT 0,
  sample_count          int  NOT NULL DEFAULT 0,
  -- Action the efficiency engine recommends
  recommendation        text NOT NULL DEFAULT 'maintain'
    CHECK (recommendation IN ('amplify', 'maintain', 'reduce', 'stop')),
  last_evaluated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, content_type, platform)
);

CREATE INDEX IF NOT EXISTS content_type_efficiency_company_idx ON content_type_efficiency(company_id);

ALTER TABLE content_type_efficiency ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON content_type_efficiency
  FOR ALL USING (auth.role() = 'service_role');

-- 3. credit_efficiency_scores — per-org efficiency tier and discount multiplier
--    Efficient orgs pay fewer credits for certain actions over time.
CREATE TABLE IF NOT EXISTS credit_efficiency_scores (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL UNIQUE,
  -- 'standard' | 'efficient' | 'optimized' | 'elite'
  efficiency_tier         text NOT NULL DEFAULT 'standard'
    CHECK (efficiency_tier IN ('standard', 'efficient', 'optimized', 'elite')),
  -- Multiplier applied to non-execution credit costs (0.6–1.0)
  discount_multiplier     float NOT NULL DEFAULT 1.0,
  total_outcomes          int  NOT NULL DEFAULT 0,
  credits_per_outcome_avg float NOT NULL DEFAULT 0,
  credits_saved_total     int  NOT NULL DEFAULT 0,
  computed_at             timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE credit_efficiency_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON credit_efficiency_scores
  FOR ALL USING (auth.role() = 'service_role');

-- 4. fail_fast_log — records when a content type was stopped mid-campaign
CREATE TABLE IF NOT EXISTS fail_fast_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL,
  campaign_id       uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  content_type      text NOT NULL,
  platform          text,
  stopped_reason    text NOT NULL,  -- e.g. "engagement_rate 0.4% < threshold 1.0%"
  engagement_rate   float NOT NULL DEFAULT 0,
  credits_reallocated int NOT NULL DEFAULT 0,
  reallocated_to    text,           -- e.g. "carousel" (the winning type)
  stopped_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fail_fast_log_company_idx ON fail_fast_log(company_id, stopped_at DESC);

ALTER TABLE fail_fast_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON fail_fast_log
  FOR ALL USING (auth.role() = 'service_role');

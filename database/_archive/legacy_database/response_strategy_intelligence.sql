-- =====================================================
-- RESPONSE STRATEGY INTELLIGENCE
-- Adaptive Response Strategy Engine: learn which strategies work.
-- Run after: response_performance_metrics, engagement_thread_classification
-- =====================================================

CREATE TABLE IF NOT EXISTS response_strategy_intelligence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  classification_category TEXT NOT NULL,
  sentiment TEXT NOT NULL DEFAULT 'neutral',
  strategy_type TEXT NOT NULL,
  total_uses INTEGER NOT NULL DEFAULT 0,
  successful_interactions INTEGER NOT NULL DEFAULT 0,
  engagement_score NUMERIC NOT NULL DEFAULT 0,
  confidence_score NUMERIC NOT NULL DEFAULT 0,
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_strategy_org_category
  ON response_strategy_intelligence(organization_id, classification_category);

CREATE INDEX IF NOT EXISTS idx_strategy_engagement
  ON response_strategy_intelligence(engagement_score DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_strategy_org_cat_sent_type
  ON response_strategy_intelligence(organization_id, classification_category, sentiment, strategy_type);

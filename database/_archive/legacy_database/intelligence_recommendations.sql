-- =====================================================
-- INTELLIGENCE RECOMMENDATIONS
-- Phase 5: Persisted recommendations for outcome/feedback tracking
-- =====================================================
-- Run after: companies (must exist)
-- =====================================================

CREATE TABLE IF NOT EXISTS intelligence_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  recommendation_type TEXT NOT NULL,
  action_summary TEXT NULL,
  supporting_signals JSONB DEFAULT '[]'::jsonb,
  confidence_score NUMERIC NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS index_intelligence_recommendations_company
  ON intelligence_recommendations (company_id);

CREATE INDEX IF NOT EXISTS index_intelligence_recommendations_created
  ON intelligence_recommendations (company_id, created_at DESC);

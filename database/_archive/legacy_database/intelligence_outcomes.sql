-- =====================================================
-- INTELLIGENCE OUTCOMES
-- Phase 5: Outcome tracking with duplication protection
-- =====================================================
-- Run after: intelligence_recommendations (must exist)
-- =====================================================

CREATE TABLE IF NOT EXISTS intelligence_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  recommendation_id UUID NULL REFERENCES intelligence_recommendations(id) ON DELETE SET NULL,
  outcome_type TEXT NOT NULL,
  success_score NUMERIC NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Outcome Duplication Protection: one outcome per (company, recommendation, type)
ALTER TABLE intelligence_outcomes
  DROP CONSTRAINT IF EXISTS intelligence_outcomes_company_rec_type_key;
ALTER TABLE intelligence_outcomes
  ADD CONSTRAINT intelligence_outcomes_company_rec_type_key
  UNIQUE (company_id, recommendation_id, outcome_type);

CREATE INDEX IF NOT EXISTS index_intelligence_outcomes_company
  ON intelligence_outcomes (company_id);

CREATE INDEX IF NOT EXISTS index_intelligence_outcomes_recommendation
  ON intelligence_outcomes (recommendation_id)
  WHERE recommendation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS index_intelligence_outcomes_company_created
  ON intelligence_outcomes (company_id, created_at DESC);

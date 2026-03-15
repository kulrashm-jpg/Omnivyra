-- =====================================================
-- FEEDBACK INTELLIGENCE
-- Actionable insights derived from engagement signals
-- =====================================================
-- Run after: engagement_signals.sql, companies
-- =====================================================

CREATE TABLE IF NOT EXISTS feedback_intelligence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id UUID REFERENCES engagement_signals(id) ON DELETE SET NULL,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  insight_type TEXT,
  insight_summary TEXT,
  impact_score NUMERIC,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS index_feedback_intelligence_company
  ON feedback_intelligence (company_id);

CREATE INDEX IF NOT EXISTS index_feedback_intelligence_type
  ON feedback_intelligence (insight_type);

CREATE INDEX IF NOT EXISTS index_feedback_intelligence_impact
  ON feedback_intelligence (company_id, impact_score DESC NULLS LAST);

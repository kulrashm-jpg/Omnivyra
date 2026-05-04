-- =====================================================
-- RECOMMENDATION FEEDBACK
-- Phase 5: Feedback with spam protection (1 per recommendation per user per hour)
-- =====================================================
-- Run after: intelligence_recommendations (must exist)
-- =====================================================

CREATE TABLE IF NOT EXISTS recommendation_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  recommendation_id UUID NOT NULL REFERENCES intelligence_recommendations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  feedback_type TEXT NOT NULL,
  feedback_score NUMERIC NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS index_recommendation_feedback_company
  ON recommendation_feedback (company_id);

CREATE INDEX IF NOT EXISTS index_recommendation_feedback_recommendation
  ON recommendation_feedback (recommendation_id);

CREATE INDEX IF NOT EXISTS index_recommendation_feedback_throttle
  ON recommendation_feedback (recommendation_id, user_id, date_trunc('hour', created_at));

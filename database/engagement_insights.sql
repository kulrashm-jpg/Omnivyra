-- =====================================================
-- ENGAGEMENT INSIGHTS
-- Insight Engine: trend analysis from engagement_opportunities
-- Run after: engagement_opportunities
-- =====================================================

CREATE TABLE IF NOT EXISTS engagement_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  insight_type TEXT NOT NULL,
  insight_title TEXT NOT NULL,
  insight_summary TEXT,
  metric_value NUMERIC NOT NULL DEFAULT 0,
  previous_value NUMERIC NOT NULL DEFAULT 0,
  change_percentage NUMERIC,
  evidence_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_engagement_insights_organization
  ON engagement_insights(organization_id);

CREATE INDEX IF NOT EXISTS idx_engagement_insights_created_at
  ON engagement_insights(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_engagement_insights_type
  ON engagement_insights(insight_type);

-- Evidence links insight to actual discussions
CREATE TABLE IF NOT EXISTS engagement_insight_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  insight_id UUID NOT NULL REFERENCES engagement_insights(id) ON DELETE CASCADE,
  thread_id UUID NOT NULL REFERENCES engagement_threads(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES engagement_messages(id) ON DELETE CASCADE,
  author_name TEXT,
  platform TEXT NOT NULL,
  text_snippet TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_engagement_insight_evidence_insight
  ON engagement_insight_evidence(insight_id);

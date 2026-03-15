-- =====================================================
-- OPPORTUNITY LEARNING METRICS
-- Learn from user actions on content opportunities
-- Run after: content_opportunities.sql (engagement_content_opportunities)
-- =====================================================

CREATE TABLE IF NOT EXISTS opportunity_learning_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  opportunity_type TEXT NOT NULL,
  approvals INTEGER NOT NULL DEFAULT 0,
  ignores INTEGER NOT NULL DEFAULT 0,
  campaigns_created INTEGER NOT NULL DEFAULT 0,
  completions INTEGER NOT NULL DEFAULT 0,
  last_updated TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_opportunity_learning_org_type UNIQUE(organization_id, opportunity_type)
);

CREATE INDEX IF NOT EXISTS idx_opportunity_learning_metrics_org
  ON opportunity_learning_metrics (organization_id);

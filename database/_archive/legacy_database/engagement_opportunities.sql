-- =====================================================
-- ENGAGEMENT OPPORTUNITIES
-- External engagement opportunity detection
-- Run after: engagement_unified_model.sql
-- =====================================================

CREATE TABLE IF NOT EXISTS engagement_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  platform TEXT NOT NULL,
  source_thread_id UUID NOT NULL REFERENCES engagement_threads(id) ON DELETE CASCADE,
  source_message_id UUID NOT NULL REFERENCES engagement_messages(id) ON DELETE CASCADE,
  author_id UUID REFERENCES engagement_authors(id) ON DELETE SET NULL,
  opportunity_type TEXT NOT NULL,
  opportunity_text TEXT,
  confidence_score NUMERIC NOT NULL DEFAULT 0,
  priority_score NUMERIC NOT NULL DEFAULT 0,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved BOOLEAN NOT NULL DEFAULT false,
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_engagement_opportunity_org_detected
  ON engagement_opportunities (organization_id, detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_engagement_opportunity_priority
  ON engagement_opportunities (priority_score DESC);

CREATE INDEX IF NOT EXISTS idx_engagement_opportunity_thread
  ON engagement_opportunities (source_thread_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_engagement_opportunity_org_message
  ON engagement_opportunities (organization_id, source_message_id);

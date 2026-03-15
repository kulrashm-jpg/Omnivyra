-- =====================================================
-- RESPONSE REPLY INTELLIGENCE
-- AI Reply Effectiveness Intelligence Layer
-- Run after: response_performance_metrics.sql
-- =====================================================

CREATE TABLE IF NOT EXISTS response_reply_intelligence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  platform TEXT NOT NULL,
  reply_pattern TEXT NOT NULL,
  reply_category TEXT NOT NULL DEFAULT 'generic_reply',
  sample_reply TEXT,
  total_replies INTEGER NOT NULL DEFAULT 0,
  total_likes INTEGER NOT NULL DEFAULT 0,
  total_followups INTEGER NOT NULL DEFAULT 0,
  total_leads INTEGER NOT NULL DEFAULT 0,
  engagement_score NUMERIC NOT NULL DEFAULT 0,
  confidence_score NUMERIC NOT NULL DEFAULT 0,
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP INDEX IF EXISTS idx_reply_intel_org_platform_pattern;
CREATE UNIQUE INDEX IF NOT EXISTS idx_reply_intel_org_platform_pattern
  ON response_reply_intelligence (organization_id, platform, reply_pattern, reply_category);

CREATE INDEX IF NOT EXISTS idx_reply_intel_org_platform
  ON response_reply_intelligence (organization_id, platform);

CREATE INDEX IF NOT EXISTS idx_reply_intel_score
  ON response_reply_intelligence (engagement_score DESC);

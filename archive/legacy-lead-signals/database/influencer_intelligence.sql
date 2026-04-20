-- =====================================================
-- INFLUENCER INTELLIGENCE
-- High-impact participants across social and community platforms
-- Run after: engagement_unified_model, engagement_opportunities, engagement_lead_signals
-- =====================================================

CREATE TABLE IF NOT EXISTS influencer_intelligence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  author_id TEXT NOT NULL,
  author_name TEXT,
  platform TEXT NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  thread_count INTEGER NOT NULL DEFAULT 0,
  reply_count INTEGER NOT NULL DEFAULT 0,
  recommendation_mentions INTEGER NOT NULL DEFAULT 0,
  question_answers INTEGER NOT NULL DEFAULT 0,
  engagement_score NUMERIC DEFAULT 0,
  influence_score NUMERIC NOT NULL DEFAULT 0,
  last_active_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_influencer_org
  ON influencer_intelligence(organization_id);

CREATE INDEX IF NOT EXISTS idx_influencer_platform
  ON influencer_intelligence(platform);

CREATE INDEX IF NOT EXISTS idx_influencer_score
  ON influencer_intelligence(influence_score DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_influencer_org_author_platform
  ON influencer_intelligence(organization_id, author_id, platform);

-- =====================================================
-- ENGAGEMENT SIGNALS
-- Captured engagement metrics from platform APIs
-- =====================================================
-- Run after: community_posts.sql
-- =====================================================

CREATE TABLE IF NOT EXISTS engagement_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID REFERENCES community_posts(id) ON DELETE CASCADE,
  platform TEXT,
  engagement_type TEXT,
  engagement_count INTEGER,
  captured_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS index_engagement_signals_post
  ON engagement_signals (post_id);

CREATE INDEX IF NOT EXISTS index_engagement_signals_platform
  ON engagement_signals (platform);

CREATE INDEX IF NOT EXISTS index_engagement_signals_captured_at
  ON engagement_signals (captured_at DESC);

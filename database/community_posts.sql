-- =====================================================
-- COMMUNITY POSTS
-- Platform-ready posts derived from campaign narratives
-- =====================================================
-- Run after: campaign_narratives.sql, companies
-- =====================================================

CREATE TABLE IF NOT EXISTS community_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  narrative_id UUID REFERENCES campaign_narratives(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  platform TEXT,
  post_content TEXT,
  post_type TEXT,
  scheduled_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS index_community_posts_narrative
  ON community_posts (narrative_id);

CREATE INDEX IF NOT EXISTS index_community_posts_company
  ON community_posts (company_id);

CREATE INDEX IF NOT EXISTS index_community_posts_platform
  ON community_posts (platform);

CREATE INDEX IF NOT EXISTS index_community_posts_scheduled_at
  ON community_posts (scheduled_at)
  WHERE scheduled_at IS NOT NULL;

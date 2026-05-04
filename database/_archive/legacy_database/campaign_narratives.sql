-- =====================================================
-- CAMPAIGN NARRATIVES
-- Story-driven campaign angles derived from content opportunities
-- =====================================================
-- Run after: content_opportunities.sql
-- =====================================================

CREATE TABLE IF NOT EXISTS campaign_narratives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID REFERENCES content_opportunities(id) ON DELETE CASCADE,
  narrative_angle TEXT,
  narrative_summary TEXT,
  target_audience TEXT,
  platform TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS index_campaign_narratives_opportunity
  ON campaign_narratives (opportunity_id);

CREATE INDEX IF NOT EXISTS index_campaign_narratives_platform
  ON campaign_narratives (platform);

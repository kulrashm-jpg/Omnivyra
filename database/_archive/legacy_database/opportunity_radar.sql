-- Opportunity Radar: structured opportunities from engagement signals.
-- Feeds campaign planner intelligence loop.

CREATE TABLE IF NOT EXISTS opportunity_radar (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  opportunity_type TEXT NOT NULL CHECK (opportunity_type IN (
    'buyer_intent', 'topic_trend', 'community_discussion', 'competitor_mention', 'product_question'
  )),
  source TEXT NOT NULL DEFAULT 'campaign_engagement',
  title TEXT NOT NULL,
  description TEXT,
  confidence_score NUMERIC NOT NULL DEFAULT 0,
  signal_count INTEGER NOT NULL DEFAULT 0,
  engagement_score_avg NUMERIC DEFAULT 0,
  topic_keywords TEXT[] DEFAULT '{}',
  related_campaign_id UUID,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  opportunity_score NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'new' CHECK (status IN ('new', 'applied_to_campaign', 'ignored')),
  applied_campaign_id UUID,
  applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_opportunity_radar_org_type_title
  ON opportunity_radar(organization_id, opportunity_type, title)
  WHERE title IS NOT NULL AND title != '';

CREATE INDEX IF NOT EXISTS idx_opportunity_radar_org_detected
  ON opportunity_radar(organization_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_opportunity_radar_score
  ON opportunity_radar(opportunity_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_opportunity_radar_campaign
  ON opportunity_radar(related_campaign_id) WHERE related_campaign_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_opportunity_radar_source
  ON opportunity_radar(source);
CREATE INDEX IF NOT EXISTS idx_opportunity_radar_status
  ON opportunity_radar(status) WHERE status = 'new';

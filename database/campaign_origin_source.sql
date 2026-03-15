-- campaign_origin_source
-- Tracks which intelligence source triggered a campaign
-- Values: opportunity, trend, strategic_insight, manual

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS origin_source TEXT;

COMMENT ON COLUMN campaigns.origin_source IS 'Intelligence source that triggered this campaign: opportunity, trend, strategic_insight, manual';

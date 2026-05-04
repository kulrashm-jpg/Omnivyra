-- =====================================================
-- ENGAGEMENT CONTENT OPPORTUNITIES
-- Persisted content opportunities from engagement signals.
-- Separate from content_opportunities (theme/campaign table).
-- Run after: engagement_unified_model.sql
-- =====================================================

CREATE TABLE IF NOT EXISTS engagement_content_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  topic TEXT NOT NULL,
  opportunity_type TEXT NOT NULL,
  suggested_title TEXT NOT NULL,
  confidence_score NUMERIC,
  signal_summary JSONB,
  source_topic TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  assigned_to UUID,
  campaign_id UUID,
  content_id UUID,
  impact_metrics JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ
);

-- Lifecycle columns (for existing tables)
ALTER TABLE engagement_content_opportunities ADD COLUMN IF NOT EXISTS assigned_to UUID;
ALTER TABLE engagement_content_opportunities ADD COLUMN IF NOT EXISTS campaign_id UUID;
ALTER TABLE engagement_content_opportunities ADD COLUMN IF NOT EXISTS content_id UUID;
ALTER TABLE engagement_content_opportunities ADD COLUMN IF NOT EXISTS impact_metrics JSONB;

CREATE INDEX IF NOT EXISTS idx_engagement_content_opportunities_org
  ON engagement_content_opportunities (organization_id);

CREATE INDEX IF NOT EXISTS idx_engagement_content_opportunities_status
  ON engagement_content_opportunities (status);

CREATE INDEX IF NOT EXISTS idx_engagement_content_opportunities_created
  ON engagement_content_opportunities (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_engagement_content_opportunities_campaign
  ON engagement_content_opportunities (campaign_id) WHERE campaign_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_engagement_content_opportunities_assigned
  ON engagement_content_opportunities (assigned_to) WHERE assigned_to IS NOT NULL;

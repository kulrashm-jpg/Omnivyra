-- =====================================================
-- ENGAGEMENT OPPORTUNITY RESOLUTION TRACKING
-- Track when opportunities are acted upon
-- Run after: engagement_opportunities.sql
-- =====================================================

ALTER TABLE engagement_opportunities
  ADD COLUMN IF NOT EXISTS resolved_by_message_id UUID REFERENCES engagement_messages(id) ON DELETE SET NULL;

ALTER TABLE engagement_opportunities
  ADD COLUMN IF NOT EXISTS resolved_by_user_id UUID;

ALTER TABLE engagement_opportunities
  ADD COLUMN IF NOT EXISTS resolution_type TEXT;

CREATE INDEX IF NOT EXISTS idx_engagement_opportunity_resolved
  ON engagement_opportunities (resolved, detected_at DESC);

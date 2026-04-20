-- =====================================================
-- OPPORTUNITY RADAR INDEXES
-- Supports aggregation queries for cross-thread opportunity counts.
-- Run after: engagement_opportunities.sql, engagement_lead_signals.sql
-- =====================================================

-- engagement_opportunities: support COUNT by opportunity_type and time window
CREATE INDEX IF NOT EXISTS idx_opportunity_radar_opportunity_type
  ON engagement_opportunities (opportunity_type);

CREATE INDEX IF NOT EXISTS idx_opportunity_radar_opportunity_detected_at
  ON engagement_opportunities (detected_at);

-- engagement_lead_signals: support COUNT by lead_intent and time window
CREATE INDEX IF NOT EXISTS idx_opportunity_radar_lead_intent
  ON engagement_lead_signals (lead_intent);

CREATE INDEX IF NOT EXISTS idx_opportunity_radar_lead_detected_at
  ON engagement_lead_signals (detected_at);

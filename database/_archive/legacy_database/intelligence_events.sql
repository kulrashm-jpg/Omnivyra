-- intelligence_events
-- Tracks all intelligence events over time for timeline visualization
-- Event types: trend_detected, insight_generated, opportunity_detected, campaign_launched, engagement_spike

CREATE TABLE IF NOT EXISTS intelligence_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_intelligence_events_company
  ON intelligence_events (company_id);

CREATE INDEX IF NOT EXISTS idx_intelligence_events_company_created
  ON intelligence_events (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_intelligence_events_type
  ON intelligence_events (event_type);

COMMENT ON TABLE intelligence_events IS 'Tracks intelligence events: trend_detected, insight_generated, opportunity_detected, campaign_launched, engagement_spike';

ALTER TABLE intelligence_events
  ADD COLUMN IF NOT EXISTS event_hash TEXT;

DROP INDEX IF EXISTS idx_intelligence_events_hash;

CREATE UNIQUE INDEX IF NOT EXISTS idx_intelligence_events_company_hash
  ON intelligence_events (company_id, event_type, event_hash)
  WHERE event_hash IS NOT NULL;

-- Engagement telemetry events for interaction tracking
-- Run after engagement_unified_model or equivalent

CREATE TABLE IF NOT EXISTS engagement_telemetry_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  thread_id TEXT,
  user_id TEXT,
  event_name TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_engagement_telemetry_org_created
  ON engagement_telemetry_events(organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_engagement_telemetry_event
  ON engagement_telemetry_events(event_name, created_at DESC);

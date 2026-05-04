-- Append-only log of resolved distribution decision per campaign week.
-- No foreign keys in v1. Used by Intelligence Observability for real counts.

CREATE TABLE IF NOT EXISTS campaign_distribution_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL,
  week_number INTEGER NOT NULL,
  resolved_strategy TEXT NOT NULL,
  auto_detected BOOLEAN NOT NULL DEFAULT false,
  quality_override BOOLEAN NOT NULL DEFAULT false,
  slot_optimization_applied BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_distribution_campaign_week
  ON campaign_distribution_decisions (campaign_id, week_number);

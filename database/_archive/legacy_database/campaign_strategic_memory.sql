-- Campaign-level strategic memory: feedback events for distribution/suggestion intelligence.
-- No foreign key in v1. Run manually or as part of migration.

CREATE TABLE IF NOT EXISTS campaign_strategic_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL,
  action TEXT NOT NULL,
  platform TEXT NULL,
  accepted BOOLEAN NOT NULL,
  confidence_score INTEGER NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_strategic_memory_campaign_id
  ON campaign_strategic_memory(campaign_id);

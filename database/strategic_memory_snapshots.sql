-- Minimal table for temporal strategic memory (week-indexed snapshots).
-- No relations. Weekly snapshots only.
-- Run manually or as part of migration; no FK to avoid coupling.

CREATE TABLE IF NOT EXISTS strategic_memory_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL,
  week_index INTEGER NOT NULL,
  metrics_summary JSONB NOT NULL DEFAULT '{}',
  insights_summary JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_strategic_memory_campaign_created
  ON strategic_memory_snapshots(campaign_id, created_at DESC);

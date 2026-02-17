-- Twelve Week Campaign Plan — AI-generated and recommendation-based blueprints
-- Table name avoids PostgreSQL/Supabase issues with numeric-prefixed identifiers.
-- Run in Supabase SQL Editor. Idempotent.

CREATE TABLE IF NOT EXISTS twelve_week_plan (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  snapshot_hash TEXT NOT NULL,
  mode TEXT,
  response TEXT,
  omnivyre_decision JSONB NOT NULL DEFAULT '{}'::jsonb,
  source TEXT NOT NULL DEFAULT 'ai',
  weeks JSONB,
  raw_plan_text TEXT,
  blueprint JSONB,
  refined_day JSONB,
  platform_content JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_twelve_week_plan_campaign
  ON twelve_week_plan(campaign_id);
CREATE INDEX IF NOT EXISTS idx_twelve_week_plan_campaign_snapshot
  ON twelve_week_plan(campaign_id, snapshot_hash);
CREATE INDEX IF NOT EXISTS idx_twelve_week_plan_created
  ON twelve_week_plan(created_at DESC);

COMMENT ON TABLE twelve_week_plan IS '12-week campaign blueprints from AI planning and recommendations';

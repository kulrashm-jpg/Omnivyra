-- campaign_execution_state: One row per campaign, tracks execution progress
-- Enables resume from last completed week/day after server restart, deployment, or worker crash.
-- Run in Supabase SQL Editor. Idempotent.

CREATE TABLE IF NOT EXISTS campaign_execution_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL UNIQUE REFERENCES campaigns(id) ON DELETE CASCADE,

  duration_weeks SMALLINT NOT NULL CHECK (duration_weeks IN (2, 4, 8, 12)),

  current_week SMALLINT NOT NULL DEFAULT 1 CHECK (current_week >= 1 AND current_week <= 12),
  current_day SMALLINT NOT NULL DEFAULT 1 CHECK (current_day >= 1 AND current_day <= 7),

  completed_weeks SMALLINT[] NOT NULL DEFAULT '{}',
  completed_days JSONB NOT NULL DEFAULT '[]',

  momentum_snapshot JSONB NOT NULL DEFAULT '{}',

  last_generated_content_id UUID REFERENCES daily_content_plans(id) ON DELETE SET NULL,

  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed')),

  started_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_current_week_range CHECK (current_week <= 12)
);

CREATE INDEX IF NOT EXISTS idx_campaign_execution_state_campaign
  ON campaign_execution_state(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_execution_state_status
  ON campaign_execution_state(status);

COMMENT ON TABLE campaign_execution_state IS 'Tracks campaign execution progress for resume after restart/deployment/crash';
COMMENT ON COLUMN campaign_execution_state.completed_days IS 'Array of {week, day} objects for completed days';
COMMENT ON COLUMN campaign_execution_state.momentum_snapshot IS 'Current week momentum_level and psychological_movement for execution layer';

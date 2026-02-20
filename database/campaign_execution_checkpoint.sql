-- campaign_execution_checkpoint: Atomic checkpoint for exactly-once progression advancement.
-- Created BEFORE content generation; completed AFTER content stored; resolved on resume.
-- Run in Supabase SQL Editor. Idempotent.

CREATE TABLE IF NOT EXISTS campaign_execution_checkpoint (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  week SMALLINT NOT NULL CHECK (week >= 1 AND week <= 12),
  day SMALLINT NOT NULL CHECK (day >= 1 AND day <= 7),

  status TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'completed', 'abandoned')),

  content_id UUID,
  content_source TEXT DEFAULT 'content_assets',

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (campaign_id, week, day)
);

CREATE INDEX IF NOT EXISTS idx_campaign_execution_checkpoint_campaign
  ON campaign_execution_checkpoint(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_execution_checkpoint_status
  ON campaign_execution_checkpoint(campaign_id, status);

COMMENT ON TABLE campaign_execution_checkpoint IS 'Atomic checkpoint: in_progress before gen, completed after store, then markDayComplete';
COMMENT ON COLUMN campaign_execution_checkpoint.content_source IS 'content_assets or daily_content_plans';
COMMENT ON COLUMN campaign_execution_checkpoint.content_id IS 'content_assets.asset_id or daily_content_plans.id';

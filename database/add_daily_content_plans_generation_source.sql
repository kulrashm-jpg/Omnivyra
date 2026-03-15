-- Add generation_source to daily_content_plans for execution engine tracking.
-- Allowed values: AI, blueprint, board, manual
ALTER TABLE daily_content_plans
ADD COLUMN IF NOT EXISTS generation_source TEXT;

COMMENT ON COLUMN daily_content_plans.generation_source IS 'Execution engine source: AI, blueprint, board, manual';

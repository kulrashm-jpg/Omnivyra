-- BOLT async execution runs and events
-- Tracks background BOLT pipeline runs with per-stage progress

CREATE TABLE IF NOT EXISTS bolt_execution_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  campaign_id TEXT,
  user_id TEXT,
  current_stage TEXT NOT NULL DEFAULT 'source-recommendation',
  status TEXT NOT NULL DEFAULT 'started',
  progress_percentage INTEGER NOT NULL DEFAULT 0 CHECK (progress_percentage >= 0 AND progress_percentage <= 100),
  payload JSONB NOT NULL DEFAULT '{}',
  result_campaign_id TEXT,
  target_campaign_id TEXT,
  error_message TEXT,
  weeks_generated INTEGER,
  daily_slots_created INTEGER,
  scheduled_posts_created INTEGER,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Prevent duplicate BOLT runs per campaign: only one run per campaign can be 'running'
CREATE UNIQUE INDEX IF NOT EXISTS bolt_single_active_run
  ON bolt_execution_runs(campaign_id)
  WHERE status = 'running';

CREATE INDEX IF NOT EXISTS idx_bolt_execution_runs_company ON bolt_execution_runs(company_id);
CREATE INDEX IF NOT EXISTS idx_bolt_execution_runs_status ON bolt_execution_runs(status);
CREATE INDEX IF NOT EXISTS idx_bolt_execution_runs_created ON bolt_execution_runs(created_at DESC);

-- Add columns if table already exists (idempotent migration)
ALTER TABLE bolt_execution_runs ADD COLUMN IF NOT EXISTS target_campaign_id TEXT;
ALTER TABLE bolt_execution_runs ADD COLUMN IF NOT EXISTS weeks_generated INTEGER;
ALTER TABLE bolt_execution_runs ADD COLUMN IF NOT EXISTS daily_slots_created INTEGER;
ALTER TABLE bolt_execution_runs ADD COLUMN IF NOT EXISTS scheduled_posts_created INTEGER;
ALTER TABLE bolt_execution_runs ADD COLUMN IF NOT EXISTS themes_generated INTEGER;
ALTER TABLE bolt_execution_runs ADD COLUMN IF NOT EXISTS weekly_plan_items INTEGER;
ALTER TABLE bolt_execution_runs ADD COLUMN IF NOT EXISTS content_variants_generated INTEGER;
ALTER TABLE bolt_execution_runs ADD COLUMN IF NOT EXISTS expected_content_items INTEGER;
ALTER TABLE bolt_execution_runs ADD COLUMN IF NOT EXISTS actual_posts_published INTEGER;
ALTER TABLE bolt_execution_runs ADD COLUMN IF NOT EXISTS engagement_score NUMERIC;
ALTER TABLE bolt_execution_runs ADD COLUMN IF NOT EXISTS conversion_score NUMERIC;
ALTER TABLE bolt_execution_runs ADD COLUMN IF NOT EXISTS ai_calls_total INTEGER;
ALTER TABLE bolt_execution_runs ADD COLUMN IF NOT EXISTS ai_tokens_input INTEGER;
ALTER TABLE bolt_execution_runs ADD COLUMN IF NOT EXISTS ai_tokens_output INTEGER;
ALTER TABLE bolt_execution_runs ADD COLUMN IF NOT EXISTS distribution_batches INTEGER;
ALTER TABLE bolt_execution_runs ADD COLUMN IF NOT EXISTS variant_batches INTEGER;
ALTER TABLE bolt_execution_runs ADD COLUMN IF NOT EXISTS ai_cost_usd NUMERIC;
ALTER TABLE bolt_execution_runs ADD COLUMN IF NOT EXISTS blueprint_cache_hits INTEGER;
ALTER TABLE bolt_execution_runs ADD COLUMN IF NOT EXISTS blueprint_cache_misses INTEGER;
ALTER TABLE bolt_execution_runs ADD COLUMN IF NOT EXISTS cache_hit_ratio NUMERIC;
ALTER TABLE bolt_execution_runs ADD COLUMN IF NOT EXISTS stage_campaign_plan_cost NUMERIC;
ALTER TABLE bolt_execution_runs ADD COLUMN IF NOT EXISTS stage_distribution_cost NUMERIC;
ALTER TABLE bolt_execution_runs ADD COLUMN IF NOT EXISTS stage_blueprint_cost NUMERIC;
ALTER TABLE bolt_execution_runs ADD COLUMN IF NOT EXISTS stage_variant_cost NUMERIC;
ALTER TABLE bolt_execution_runs ADD COLUMN IF NOT EXISTS strategy_learning_applied BOOLEAN;
ALTER TABLE bolt_execution_runs ADD COLUMN IF NOT EXISTS strategy_learning_confidence NUMERIC;
ALTER TABLE bolt_execution_runs ADD COLUMN IF NOT EXISTS strategy_profile_cache_hits INTEGER;
ALTER TABLE bolt_execution_runs ADD COLUMN IF NOT EXISTS strategy_profile_cache_misses INTEGER;

CREATE INDEX IF NOT EXISTS idx_bolt_execution_runs_target_campaign ON bolt_execution_runs(target_campaign_id) WHERE target_campaign_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS bolt_execution_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES bolt_execution_runs(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bolt_execution_events_run ON bolt_execution_events(run_id);
CREATE INDEX IF NOT EXISTS idx_bolt_execution_events_created ON bolt_execution_events(run_id, created_at);

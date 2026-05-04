-- Add external_post_id to daily_content_plans for linking to platform posts (activity → post mapping).
-- Run in Supabase SQL Editor. Idempotent.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'daily_content_plans' AND column_name = 'external_post_id') THEN
    ALTER TABLE daily_content_plans ADD COLUMN external_post_id TEXT;
    RAISE NOTICE 'Added daily_content_plans.external_post_id';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'daily_content_plans' AND column_name = 'execution_id') THEN
    ALTER TABLE daily_content_plans ADD COLUMN execution_id TEXT;
    RAISE NOTICE 'Added daily_content_plans.execution_id';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'daily_content_plans' AND column_name = 'scheduled_post_id') THEN
    ALTER TABLE daily_content_plans ADD COLUMN scheduled_post_id UUID;
    RAISE NOTICE 'Added daily_content_plans.scheduled_post_id';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_daily_content_plans_external_post
  ON daily_content_plans(external_post_id) WHERE external_post_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_daily_content_plans_execution_id
  ON daily_content_plans(execution_id) WHERE execution_id IS NOT NULL;

-- =====================================================
-- CAMPAIGN STAGE COLUMNS MIGRATION
-- =====================================================
-- Adds/verifies columns for workflow stages:
-- planning → twelve_week_plan → daily_plan → charting → schedule
-- Run this after campaigns and campaign_versions tables exist.
-- =====================================================

-- STEP 1: VERIFY (run separately to check current state)
-- =====================================================
-- Uncomment and run to inspect existing schema:
/*
SELECT 
  table_name,
  column_name,
  data_type,
  column_default,
  character_maximum_length
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'campaigns' AND column_name IN ('current_stage', 'status'))
    OR (table_name = 'campaign_versions' AND column_name = 'status')
  )
ORDER BY table_name, column_name;
*/

-- STEP 2: ADD COLUMNS (idempotent - safe to run multiple times)
-- =====================================================

DO $$
BEGIN
  -- campaigns.current_stage: workflow stage (planning, twelve_week_plan, daily_plan, charting, schedule)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'campaigns' AND column_name = 'current_stage'
  ) THEN
    ALTER TABLE campaigns ADD COLUMN current_stage VARCHAR(50) DEFAULT 'planning';
    RAISE NOTICE 'Added campaigns.current_stage';
  ELSE
    RAISE NOTICE 'campaigns.current_stage already exists';
  END IF;
END $$;

-- Index for filtering by stage (optional but helpful for dashboard queries)
CREATE INDEX IF NOT EXISTS idx_campaigns_current_stage ON campaigns(current_stage);

-- campaign_versions.status: no change needed - stores stage when synced
-- (status is TEXT, no constraint - accepts planning, twelve_week_plan, daily_plan, charting, schedule)

-- STEP 3: BACKFILL (optional - set NULL current_stage to 'planning')
-- =====================================================
/*
UPDATE campaigns 
SET current_stage = 'planning' 
WHERE current_stage IS NULL OR current_stage = '';
*/

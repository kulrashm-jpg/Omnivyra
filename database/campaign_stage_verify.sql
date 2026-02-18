-- =====================================================
-- CAMPAIGN STAGE VERIFICATION
-- =====================================================
-- Run this to check if tables/columns exist before or after migration.
-- Queries return empty if tables don't exist yet.
-- =====================================================

-- Check campaigns table and required columns
SELECT 
  'campaigns' AS table_name,
  column_name,
  data_type,
  character_maximum_length,
  column_default,
  CASE WHEN column_name = 'current_stage' THEN 'WORKFLOW STAGE' 
       WHEN column_name = 'status' THEN 'LIFECYCLE' 
       ELSE NULL END AS usage
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'campaigns'
  AND column_name IN ('current_stage', 'status')
ORDER BY column_name;

-- Check campaign_versions table and status column
SELECT 
  'campaign_versions' AS table_name,
  column_name,
  data_type,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'campaign_versions'
  AND column_name = 'status';

-- Check index on current_stage (if migration was run)
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'campaigns'
  AND indexname = 'idx_campaigns_current_stage';

-- Sample current_stage values in use
SELECT current_stage, COUNT(*) AS count
FROM campaigns
GROUP BY current_stage
ORDER BY count DESC;

-- =====================================================
-- VERIFY CAMPAIGN PLAN RELATIONSHIPS
-- =====================================================
-- Run after campaign_plan_relationships.sql to check links
-- =====================================================

-- 1. Table structure (IDs and FKs)
SELECT 
  'twelve_week_plan' AS tbl,
  column_name,
  data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'twelve_week_plan'
  AND column_name IN ('id', 'campaign_id')
ORDER BY ordinal_position;

SELECT 
  'weekly_content_refinements' AS tbl,
  column_name,
  data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'weekly_content_refinements'
  AND column_name IN ('id', 'campaign_id', 'twelve_week_plan_id', 'week_number')
ORDER BY ordinal_position;

SELECT 
  'daily_content_plans' AS tbl,
  column_name,
  data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'daily_content_plans'
  AND column_name IN ('id', 'campaign_id', 'week_number', 'weekly_refinement_id', 'source_refinement_id')
ORDER BY ordinal_position;

-- 2. Sample link chain
SELECT 
  t.id AS twelve_week_plan_id,
  t.campaign_id,
  w.id AS week_plan_id,
  w.week_number,
  w.twelve_week_plan_id
FROM twelve_week_plan t
LEFT JOIN weekly_content_refinements w ON w.twelve_week_plan_id = t.id
ORDER BY t.created_at DESC, w.week_number
LIMIT 5;

-- 3. Daily plans linked to week plans (uses source_refinement_id - or weekly_refinement_id if that column exists)
SELECT 
  d.id AS daily_plan_id,
  d.campaign_id,
  d.week_number,
  d.day_of_week,
  d.source_refinement_id AS parent_week_id,
  w.twelve_week_plan_id AS parent_12week_id
FROM daily_content_plans d
LEFT JOIN weekly_content_refinements w ON d.source_refinement_id = w.id
ORDER BY d.campaign_id, d.week_number, d.day_of_week
LIMIT 10;

-- ============================================================
-- VERIFY COMMITTED PLAN
-- ============================================================
-- Run query 1 FIRST (no edits needed). Copy a campaign_id from the results.
-- For query 2, paste that UUID in place of the example.
-- ============================================================

-- 1. List ALL recent committed plans — RUN THIS FIRST, no changes needed
SELECT 
  campaign_id,
  source,
  created_at,
  jsonb_array_length(COALESCE(blueprint->'weeks', '[]'::jsonb)) AS week_count,
  (blueprint->'weeks'->0->>'phase_label') AS week_1_theme
FROM twelve_week_plan
ORDER BY created_at DESC
LIMIT 15;

-- 2. Check one campaign — replace the UUID below with a campaign_id from query 1
--    Example: if query 1 shows campaign_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
--    then change the WHERE clause to use that exact value
SELECT 
  id,
  campaign_id,
  source,
  created_at,
  jsonb_array_length(COALESCE(blueprint->'weeks', '[]'::jsonb)) AS week_count,
  blueprint->'weeks'->0 AS week_1_full
FROM twelve_week_plan
WHERE campaign_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'  -- ← paste your campaign_id here
ORDER BY created_at DESC
LIMIT 1;

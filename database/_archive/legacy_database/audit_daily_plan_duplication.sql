-- =============================================================================
-- DUPLICATION AUDIT: daily_content_plans
-- Run to see how much duplicate or excess data exists. Safe to run (read-only).
-- =============================================================================

-- 1. TOTAL ROW COUNT
SELECT COUNT(*) AS total_rows FROM daily_content_plans;

-- 2. ROWS PER CAMPAIGN + WEEK (expect 7 per week if one plan per day)
-- If you see 14, 21, etc. — same campaign+week was generated multiple times
SELECT 
  campaign_id,
  week_number,
  COUNT(*) AS plan_count,
  array_agg(day_of_week ORDER BY day_of_week) AS days
FROM daily_content_plans
GROUP BY campaign_id, week_number
ORDER BY plan_count DESC, campaign_id, week_number;

-- 3. DUPLICATE SLOTS: same campaign + week + day_of_week (definite duplicates)
SELECT 
  campaign_id,
  week_number,
  day_of_week,
  COUNT(*) AS dup_count,
  array_agg(id::text) AS ids
FROM daily_content_plans
GROUP BY campaign_id, week_number, day_of_week
HAVING COUNT(*) > 1
ORDER BY dup_count DESC;

-- 4. SUMMARY: how many duplicate slots and total redundant rows?
WITH dup_slots AS (
  SELECT campaign_id, week_number, day_of_week, COUNT(*) AS n
  FROM daily_content_plans
  GROUP BY campaign_id, week_number, day_of_week
  HAVING COUNT(*) > 1
),
redundant AS (
  SELECT SUM(n - 1) AS extra_rows FROM dup_slots
)
SELECT 
  (SELECT COUNT(*) FROM daily_content_plans) AS total_rows,
  (SELECT COUNT(*) FROM dup_slots) AS duplicate_slots,
  (SELECT extra_rows FROM redundant) AS redundant_rows_to_remove;

-- 5. KEEP ONE, REMOVE OTHERS (optional — uncomment to run)
-- Keeps the most recent row per (campaign_id, week_number, day_of_week)
/*
DELETE FROM daily_content_plans d
USING daily_content_plans d2
WHERE d.campaign_id = d2.campaign_id
  AND d.week_number = d2.week_number
  AND d.day_of_week = d2.day_of_week
  AND d.id < d2.id;
*/

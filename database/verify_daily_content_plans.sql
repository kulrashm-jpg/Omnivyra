-- Daily Plan Generation Pipeline — Verification Script
-- Run after triggering "Generate from AI" or "Regenerate" to verify DB write.

-- 1. List all daily plans (no filter — works out of the box)
SELECT
  id,
  campaign_id,
  week_number,
  day_of_week,
  date,
  platform,
  content_type,
  title,
  ai_generated,
  created_at
FROM daily_content_plans
ORDER BY campaign_id, week_number, day_of_week;

-- 2. Count per campaign and week
SELECT campaign_id, week_number, COUNT(*) AS plan_count
FROM daily_content_plans
GROUP BY campaign_id, week_number
ORDER BY campaign_id, week_number;

-- 3. To filter by a specific campaign, run manually:
--    SELECT * FROM daily_content_plans WHERE campaign_id = 'your-uuid-here';

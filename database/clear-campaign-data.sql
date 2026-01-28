-- =====================================================
-- CLEAR CAMPAIGN DATA - QUICK CLEANUP
-- =====================================================
-- This script clears all campaign-related data from the database
-- WARNING: This will permanently delete all campaign data!
-- =====================================================

-- Step 1: Show current data counts
SELECT 'BEFORE CLEANUP - Current Data Counts:' as info;
SELECT 'campaigns' as table_name, COUNT(*) as count FROM campaigns
UNION ALL
SELECT 'campaign_goals', COUNT(*) FROM campaign_goals
UNION ALL
SELECT 'weekly_content_refinements', COUNT(*) FROM weekly_content_refinements
UNION ALL
SELECT 'daily_content_plans', COUNT(*) FROM daily_content_plans
UNION ALL
SELECT 'campaign_performance', COUNT(*) FROM campaign_performance;

-- Step 2: Clear data in dependency order (child tables first)
DELETE FROM daily_content_plans;
DELETE FROM weekly_content_refinements;
DELETE FROM campaign_performance;
DELETE FROM campaign_goals;
DELETE FROM campaigns;

-- Step 3: Show final counts (should all be 0)
SELECT 'AFTER CLEANUP - Final Data Counts:' as info;
SELECT 'campaigns' as table_name, COUNT(*) as count FROM campaigns
UNION ALL
SELECT 'campaign_goals', COUNT(*) FROM campaign_goals
UNION ALL
SELECT 'weekly_content_refinements', COUNT(*) FROM weekly_content_refinements
UNION ALL
SELECT 'daily_content_plans', COUNT(*) FROM daily_content_plans
UNION ALL
SELECT 'campaign_performance', COUNT(*) FROM campaign_performance;

-- Step 4: Success message
SELECT 'Campaign data cleared successfully! All tables are now empty.' as result;







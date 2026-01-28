-- =====================================================
-- EXECUTE DATABASE CLEANUP
-- =====================================================
-- WARNING: This will permanently delete unnecessary tables!
-- Make sure you've reviewed the preview-cleanup.sql results first
-- =====================================================

-- Step 1: Show what we're about to delete
SELECT 'ABOUT TO DELETE UNNECESSARY TABLES...' as warning;

-- Step 2: Delete unnecessary tables using dynamic SQL
DO $$
DECLARE
    table_name text;
    deleted_count integer := 0;
BEGIN
    -- Loop through all tables that are NOT in our required list
    FOR table_name IN 
        SELECT t.table_name 
        FROM information_schema.tables t
        WHERE t.table_schema = 'public' 
        AND t.table_name NOT IN (
            'users',
            'campaigns', 
            'campaign_goals',
            'market_analyses',
            'content_plans',
            'schedule_reviews',
            'ai_threads',
            'ai_feedback',
            'ai_improvements',
            'campaign_learnings',
            'campaign_analytics',
            'campaign_performance',
            'api_integrations',
            'webhook_logs'
        )
    LOOP
        -- Drop the table
        EXECUTE 'DROP TABLE IF EXISTS ' || table_name || ' CASCADE';
        deleted_count := deleted_count + 1;
        RAISE NOTICE 'Deleted table: %', table_name;
    END LOOP;
    
    RAISE NOTICE 'Cleanup completed! Deleted % tables.', deleted_count;
END $$;

-- Step 3: Show final results
SELECT 'CLEANUP COMPLETED!' as result;
SELECT COUNT(*) as remaining_tables FROM information_schema.tables 
WHERE table_schema = 'public';

-- Step 4: Show remaining tables (should be exactly 14)
SELECT 'REMAINING TABLES:' as info;
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;

-- Step 5: Verify all required tables exist
SELECT 'VERIFICATION - ALL REQUIRED TABLES PRESENT:' as info;
SELECT 
    CASE 
        WHEN COUNT(*) = 14 THEN '✅ SUCCESS: All 14 required tables present'
        ELSE '❌ ERROR: Missing tables - only ' || COUNT(*) || ' of 14 tables found'
    END as status
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN (
    'users',
    'campaigns', 
    'campaign_goals',
    'market_analyses',
    'content_plans',
    'schedule_reviews',
    'ai_threads',
    'ai_feedback',
    'ai_improvements',
    'campaign_learnings',
    'campaign_analytics',
    'campaign_performance',
    'api_integrations',
    'webhook_logs'
);

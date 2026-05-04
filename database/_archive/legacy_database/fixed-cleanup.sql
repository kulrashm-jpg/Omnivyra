-- =====================================================
-- FIXED DATABASE CLEANUP - HANDLES VIEWS AND TABLES
-- =====================================================
-- This script properly handles both tables and views
-- =====================================================

-- Step 1: Show what we're about to delete
SELECT 'ABOUT TO DELETE UNNECESSARY TABLES AND VIEWS...' as warning;

-- Step 2: Delete unnecessary tables and views using dynamic SQL
DO $$
DECLARE
    object_name text;
    object_type text;
    deleted_count integer := 0;
BEGIN
    -- First, drop all views that are not in our required list
    FOR object_name IN 
        SELECT viewname 
        FROM pg_views 
        WHERE schemaname = 'public' 
        AND viewname NOT IN (
            'campaign_summary',
            'ai_insights_summary'
        )
    LOOP
        EXECUTE 'DROP VIEW IF EXISTS ' || object_name || ' CASCADE';
        deleted_count := deleted_count + 1;
        RAISE NOTICE 'Deleted view: %', object_name;
    END LOOP;
    
    -- Then, drop all tables that are not in our required list
    FOR object_name IN 
        SELECT t.table_name 
        FROM information_schema.tables t
        WHERE t.table_schema = 'public' 
        AND t.table_type = 'BASE TABLE'
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
        EXECUTE 'DROP TABLE IF EXISTS ' || object_name || ' CASCADE';
        deleted_count := deleted_count + 1;
        RAISE NOTICE 'Deleted table: %', object_name;
    END LOOP;
    
    RAISE NOTICE 'Cleanup completed! Deleted % objects.', deleted_count;
END $$;

-- Step 3: Show final results
SELECT 'CLEANUP COMPLETED!' as result;
SELECT COUNT(*) as remaining_tables FROM information_schema.tables 
WHERE table_schema = 'public' AND table_type = 'BASE TABLE';

-- Step 4: Show remaining tables (should be exactly 14)
SELECT 'REMAINING TABLES:' as info;
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name;

-- Step 5: Show remaining views
SELECT 'REMAINING VIEWS:' as info;
SELECT viewname FROM pg_views 
WHERE schemaname = 'public'
ORDER BY viewname;

-- Step 6: Verify all required tables exist
SELECT 'VERIFICATION - ALL REQUIRED TABLES PRESENT:' as info;
SELECT 
    CASE 
        WHEN COUNT(*) = 14 THEN '✅ SUCCESS: All 14 required tables present'
        ELSE '❌ ERROR: Missing tables - only ' || COUNT(*) || ' of 14 tables found'
    END as status
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_type = 'BASE TABLE'
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

-- =====================================================
-- DATABASE VERIFICATION SCRIPT
-- =====================================================
-- This script verifies that all required tables exist
-- and shows the current database structure
-- =====================================================

-- Check all tables exist
SELECT 
    'TABLE CHECK' as check_type,
    table_name,
    'EXISTS' as status
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
    )
ORDER BY table_name;

-- Show table structures
SELECT 
    'TABLE STRUCTURE' as check_type,
    table_name,
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
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
    )
ORDER BY table_name, ordinal_position;

-- Check indexes
SELECT 
    'INDEX CHECK' as check_type,
    indexname,
    tablename,
    indexdef
FROM pg_indexes 
WHERE schemaname = 'public' 
    AND tablename IN (
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
ORDER BY tablename, indexname;

-- Check triggers
SELECT 
    'TRIGGER CHECK' as check_type,
    trigger_name,
    event_object_table,
    action_timing,
    event_manipulation
FROM information_schema.triggers 
WHERE trigger_schema = 'public' 
    AND event_object_table IN (
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
ORDER BY event_object_table, trigger_name;

-- Check views
SELECT 
    'VIEW CHECK' as check_type,
    table_name as view_name,
    'EXISTS' as status
FROM information_schema.views 
WHERE table_schema = 'public' 
    AND table_name IN ('campaign_summary', 'ai_insights_summary')
ORDER BY table_name;

-- Check functions
SELECT 
    'FUNCTION CHECK' as check_type,
    routine_name,
    routine_type,
    'EXISTS' as status
FROM information_schema.routines 
WHERE routine_schema = 'public' 
    AND routine_name IN ('get_campaign_progress', 'transition_campaign_stage', 'update_updated_at_column')
ORDER BY routine_name;

-- Sample data check
SELECT 
    'SAMPLE DATA' as check_type,
    'users' as table_name,
    COUNT(*) as row_count
FROM users
UNION ALL
SELECT 
    'SAMPLE DATA' as check_type,
    'campaigns' as table_name,
    COUNT(*) as row_count
FROM campaigns;

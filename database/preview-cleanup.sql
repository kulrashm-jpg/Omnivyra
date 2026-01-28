-- =====================================================
-- SAFE DATABASE CLEANUP - STEP BY STEP
-- =====================================================
-- Run this to see what tables will be deleted before actually deleting them
-- =====================================================

-- Step 1: Show current situation
SELECT 'CURRENT DATABASE STATUS:' as info;
SELECT COUNT(*) as total_tables FROM information_schema.tables 
WHERE table_schema = 'public';

-- Step 2: Show our required tables (these will be kept)
SELECT 'REQUIRED TABLES (will be kept):' as info;
SELECT table_name FROM information_schema.tables 
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

-- Step 3: Show tables that will be deleted
SELECT 'TABLES TO DELETE (unnecessary):' as info;
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name NOT IN (
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

-- Step 4: Count how many will be deleted
SELECT 'SUMMARY:' as info;
SELECT 
    (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public') as current_tables,
    (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' 
     AND table_name IN ('users','campaigns','campaign_goals','market_analyses','content_plans',
                       'schedule_reviews','ai_threads','ai_feedback','ai_improvements',
                       'campaign_learnings','campaign_analytics','campaign_performance',
                       'api_integrations','webhook_logs')) as required_tables,
    (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' 
     AND table_name NOT IN ('users','campaigns','campaign_goals','market_analyses','content_plans',
                           'schedule_reviews','ai_threads','ai_feedback','ai_improvements',
                           'campaign_learnings','campaign_analytics','campaign_performance',
                           'api_integrations','webhook_logs')) as tables_to_delete;

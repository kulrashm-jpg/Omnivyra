-- =====================================================
-- DATABASE CLEANUP - REMOVE UNNECESSARY TABLES
-- =====================================================
-- This script removes all tables except the 14 required for Campaign Management
-- =====================================================

-- Step 1: Show current table count
SELECT 'BEFORE CLEANUP:' as step;
SELECT COUNT(*) as total_tables FROM information_schema.tables 
WHERE table_schema = 'public';

-- Step 2: List all tables that will be kept
SELECT 'TABLES TO KEEP:' as step;
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

-- Step 3: List tables that will be deleted
SELECT 'TABLES TO DELETE:' as step;
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

-- Step 4: Create backup of important data (optional)
-- Uncomment the lines below if you want to backup any important data
-- CREATE TABLE backup_users AS SELECT * FROM users;
-- CREATE TABLE backup_campaigns AS SELECT * FROM campaigns;

-- Step 5: Drop unnecessary tables
-- WARNING: This will permanently delete data!
-- Make sure you have backups if needed

-- Drop tables that are not part of our campaign management system
DROP TABLE IF EXISTS blog_posts CASCADE;
DROP TABLE IF EXISTS testimonials CASCADE;
DROP TABLE IF EXISTS profiles CASCADE;
DROP TABLE IF EXISTS sessions CASCADE;
DROP TABLE IF EXISTS invitations CASCADE;
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS subscriptions CASCADE;
DROP TABLE IF EXISTS media CASCADE;
DROP TABLE IF EXISTS categories CASCADE;
DROP TABLE IF EXISTS pricing_plans CASCADE;
DROP TABLE IF EXISTS testimonial_translations CASCADE;
DROP TABLE IF EXISTS blog_translations CASCADE;
DROP TABLE IF EXISTS admin_users CASCADE;
DROP TABLE IF EXISTS pricing_tiers CASCADE;
DROP TABLE IF EXISTS currency_rates CASCADE;
DROP TABLE IF EXISTS testimonials_translations CASCADE;

-- Drop any other tables that might exist (be careful with this!)
-- Uncomment the section below to drop ALL tables except our 14 required ones
/*
DO $$
DECLARE
    table_name text;
BEGIN
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
        EXECUTE 'DROP TABLE IF EXISTS ' || table_name || ' CASCADE';
        RAISE NOTICE 'Dropped table: %', table_name;
    END LOOP;
END $$;
*/

-- Step 6: Show final table count
SELECT 'AFTER CLEANUP:' as step;
SELECT COUNT(*) as total_tables FROM information_schema.tables 
WHERE table_schema = 'public';

-- Step 7: Show remaining tables
SELECT 'REMAINING TABLES:' as step;
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;

-- Step 8: Verify our required tables still exist
SELECT 'VERIFICATION - REQUIRED TABLES:' as step;
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

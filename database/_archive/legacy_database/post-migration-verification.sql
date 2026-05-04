-- POST-MIGRATION VERIFICATION SCRIPT
-- Run this to confirm all tables and columns are properly set up

-- ==============================================
-- VERIFY ALL TABLES EXIST
-- ==============================================

SELECT 
    'TABLE VERIFICATION' as check_type,
    table_name,
    CASE 
        WHEN table_name IN (
            'campaigns',
            'weekly_content_refinements',
            'daily_content_plans',
            'campaign_strategies',
            'content_pillars',
            'platform_strategies',
            'campaign_performance_metrics',
            'ai_enhancement_logs',
            'content_templates_enhanced'
        ) THEN '✅ EXISTS'
        ELSE '❌ MISSING'
    END as status
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN (
    'campaigns',
    'weekly_content_refinements',
    'daily_content_plans',
    'campaign_strategies',
    'content_pillars',
    'platform_strategies',
    'campaign_performance_metrics',
    'ai_enhancement_logs',
    'content_templates_enhanced'
)
ORDER BY table_name;

-- ==============================================
-- VERIFY KEY COLUMNS IN CAMPAIGNS TABLE
-- ==============================================

SELECT 
    'CAMPAIGNS ENHANCED COLUMNS' as check_type,
    column_name,
    CASE 
        WHEN column_name IN (
            'weekly_themes',
            'ai_generated_summary', 
            'current_stage',
            'thread_id'
        ) THEN '✅ ADDED'
        ELSE '📋 EXISTING'
    END as status
FROM information_schema.columns 
WHERE table_name = 'campaigns' 
AND column_name IN (
    'id', 'name', 'description', 'start_date', 'end_date', 'status',
    'weekly_themes', 'ai_generated_summary', 'current_stage', 'thread_id'
)
ORDER BY column_name;

-- ==============================================
-- VERIFY WEEKLY REFINEMENTS ENHANCEMENTS
-- ==============================================

SELECT 
    'WEEKLY REFINEMENTS ENHANCED' as check_type,
    column_name,
    CASE 
        WHEN column_name IN (
            'phase',
            'key_messaging',
            'content_types',
            'platform_strategy',
            'call_to_action',
            'target_metrics',
            'content_guidelines',
            'hashtag_suggestions',
            'completion_percentage'
        ) THEN '✅ ENHANCED'
        ELSE '📋 EXISTING'
    END as status
FROM information_schema.columns 
WHERE table_name = 'weekly_content_refinements' 
ORDER BY column_name;

-- ==============================================
-- VERIFY DAILY PLANS ENHANCEMENTS
-- ==============================================

SELECT 
    'DAILY PLANS ENHANCED' as check_type,
    column_name,
    CASE 
        WHEN column_name IN (
            'media_requirements',
            'visual_elements',
            'media_urls',
            'engagement_strategy',
            'posting_strategy',
            'target_metrics',
            'actual_metrics',
            'ai_generated'
        ) THEN '✅ ENHANCED'
        ELSE '📋 EXISTING'
    END as status
FROM information_schema.columns 
WHERE table_name = 'daily_content_plans' 
ORDER BY column_name;

-- ==============================================
-- VERIFY NEW TABLES STRUCTURE
-- ==============================================

-- Check campaign_strategies table
SELECT 
    'CAMPAIGN STRATEGIES' as check_type,
    column_name,
    data_type,
    'NEW TABLE' as status
FROM information_schema.columns 
WHERE table_name = 'campaign_strategies' 
ORDER BY ordinal_position;

-- Check content_pillars table
SELECT 
    'CONTENT PILLARS' as check_type,
    column_name,
    data_type,
    'NEW TABLE' as status
FROM information_schema.columns 
WHERE table_name = 'content_pillars' 
ORDER BY ordinal_position;

-- Check platform_strategies table
SELECT 
    'PLATFORM STRATEGIES' as check_type,
    column_name,
    data_type,
    'NEW TABLE' as status
FROM information_schema.columns 
WHERE table_name = 'platform_strategies' 
ORDER BY ordinal_position;

-- ==============================================
-- VERIFY INDEXES
-- ==============================================

SELECT 
    'INDEXES CREATED' as check_type,
    indexname,
    tablename,
    'PERFORMANCE INDEX' as status
FROM pg_indexes 
WHERE schemaname = 'public'
AND indexname IN (
    'idx_campaign_strategies_campaign',
    'idx_content_pillars_campaign',
    'idx_platform_strategies_campaign',
    'idx_performance_metrics_campaign',
    'idx_performance_metrics_week',
    'idx_ai_enhancement_campaign'
)
ORDER BY tablename;

-- ==============================================
-- FINAL SUMMARY
-- ==============================================

SELECT 
    'MIGRATION SUMMARY' as check_type,
    'Total enhanced tables' as description,
    COUNT(*)::text as count
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN (
    'campaign_strategies',
    'content_pillars',
    'platform_strategies',
    'campaign_performance_metrics',
    'ai_enhancement_logs',
    'content_templates_enhanced'
);

SELECT 
    'MIGRATION SUMMARY' as check_type,
    'Enhanced existing tables' as description,
    '3' as count;

SELECT 
    'MIGRATION SUMMARY' as check_type,
    'Total indexes created' as description,
    COUNT(*)::text as count
FROM pg_indexes 
WHERE schemaname = 'public'
AND indexname LIKE 'idx_%';




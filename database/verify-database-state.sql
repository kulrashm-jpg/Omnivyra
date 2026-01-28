-- DATABASE STATE VERIFICATION SCRIPT
-- Run this to check what tables and columns currently exist

-- ==============================================
-- CHECK EXISTING TABLES
-- ==============================================

SELECT 
    'EXISTING TABLES' as check_type,
    table_name,
    'Table exists' as status
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
-- CHECK CAMPAIGNS TABLE COLUMNS
-- ==============================================

SELECT 
    'CAMPAIGNS COLUMNS' as check_type,
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'campaigns' 
ORDER BY ordinal_position;

-- ==============================================
-- CHECK WEEKLY_CONTENT_REFINEMENTS COLUMNS
-- ==============================================

SELECT 
    'WEEKLY_REFINEMENTS COLUMNS' as check_type,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'weekly_content_refinements' 
ORDER BY ordinal_position;

-- ==============================================
-- CHECK DAILY_CONTENT_PLANS COLUMNS
-- ==============================================

SELECT 
    'DAILY_PLANS COLUMNS' as check_type,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'daily_content_plans' 
ORDER BY ordinal_position;

-- ==============================================
-- SUMMARY REPORT
-- ==============================================

SELECT 
    'SUMMARY' as check_type,
    'Total tables checked' as column_name,
    COUNT(*)::text as data_type
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
);




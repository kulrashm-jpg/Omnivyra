-- =====================================================
-- DATABASE VALIDATION SCRIPT
-- =====================================================
-- Comprehensive validation for:
-- 1) Foreign-key integrity
-- 2) Index coverage
-- 3) Orphan record detection
-- 4) Schema diff verification
-- 5) Constraint naming consistency
-- =====================================================

\echo '========================================'
\echo 'DATABASE VALIDATION REPORT'
\echo '========================================'
\echo ''

-- ==============================================
-- 1. FOREIGN KEY INTEGRITY CHECK
-- ==============================================
\echo '1. FOREIGN KEY INTEGRITY CHECK'
\echo '----------------------------------------'

DO $$
DECLARE
    fk_record RECORD;
    orphan_count INTEGER;
    total_orphans INTEGER := 0;
    total_fks INTEGER := 0;
    failed_fks TEXT[] := ARRAY[]::TEXT[];
BEGIN
    FOR fk_record IN
        SELECT
            tc.table_name AS child_table,
            kcu.column_name AS child_column,
            ccu.table_name AS parent_table,
            ccu.column_name AS parent_column,
            tc.constraint_name
        FROM information_schema.table_constraints AS tc
        JOIN information_schema.key_column_usage AS kcu
            ON tc.constraint_name = kcu.constraint_name
        JOIN information_schema.constraint_column_usage AS ccu
            ON ccu.constraint_name = tc.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
        ORDER BY tc.table_name, kcu.column_name
    LOOP
        total_fks := total_fks + 1;
        
        -- Check for orphan records
        EXECUTE format(
            'SELECT COUNT(*) FROM %I.%I WHERE %I IS NOT NULL AND NOT EXISTS (
                SELECT 1 FROM %I.%I WHERE %I.%I.%I = %I.%I.%I
            )',
            'public',
            fk_record.child_table,
            fk_record.child_column,
            'public',
            fk_record.parent_table,
            'public',
            fk_record.child_table,
            fk_record.child_column,
            'public',
            fk_record.parent_table,
            fk_record.parent_column
        ) INTO orphan_count;
        
        IF orphan_count > 0 THEN
            failed_fks := array_append(failed_fks, 
                format('%s.%s -> %s.%s: %s orphans',
                    fk_record.child_table,
                    fk_record.child_column,
                    fk_record.parent_table,
                    fk_record.parent_column,
                    orphan_count
                )
            );
            total_orphans := total_orphans + orphan_count;
        END IF;
    END LOOP;
    
    RAISE NOTICE 'Total Foreign Keys Checked: %', total_fks;
    IF total_orphans = 0 THEN
        RAISE NOTICE '✓ PASS: No orphan records found';
    ELSE
        RAISE NOTICE '✗ FAIL: Found % orphan records across % foreign keys', total_orphans, array_length(failed_fks, 1);
        FOREACH fk_record IN ARRAY failed_fks LOOP
            RAISE NOTICE '  - %', fk_record;
        END LOOP;
    END IF;
END $$;

-- ==============================================
-- 2. INDEX COVERAGE ANALYSIS
-- ==============================================
\echo ''
\echo '2. INDEX COVERAGE ANALYSIS'
\echo '----------------------------------------'

-- Analyze tables first for up-to-date statistics
DO $$
DECLARE
    table_record RECORD;
BEGIN
    FOR table_record IN
        SELECT tablename 
        FROM pg_tables 
        WHERE schemaname = 'public'
        ORDER BY tablename
    LOOP
        EXECUTE format('ANALYZE %I', table_record.tablename);
    END LOOP;
END $$;

-- Check for missing indexes on foreign key columns
SELECT
    CASE
        WHEN idx.indexname IS NULL THEN '✗ MISSING'
        ELSE '✓ EXISTS'
    END as index_status,
    tc.table_name as table_name,
    kcu.column_name as column_name,
    tc.constraint_name as fk_constraint,
    COALESCE(idx.indexname, 'NO INDEX') as index_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
LEFT JOIN pg_indexes idx
    ON idx.tablename = tc.table_name
    AND idx.indexname LIKE '%' || kcu.column_name || '%'
    AND idx.schemaname = 'public'
WHERE tc.constraint_type = 'FOREIGN KEY'
AND tc.table_schema = 'public'
ORDER BY tc.table_name, kcu.column_name;

-- Check for columns commonly used in WHERE/JOIN without indexes
SELECT
    'CHECK' as check_type,
    t.table_name,
    c.column_name,
    CASE
        WHEN EXISTS (
            SELECT 1 FROM pg_indexes 
            WHERE tablename = t.table_name 
            AND indexdef LIKE '%' || c.column_name || '%'
        ) THEN '✓ INDEXED'
        ELSE '✗ NOT INDEXED'
    END as index_status
FROM information_schema.tables t
JOIN information_schema.columns c ON t.table_name = c.table_name
WHERE t.table_schema = 'public'
AND t.table_type = 'BASE TABLE'
AND c.column_name LIKE '%_id'
AND c.column_name NOT IN ('id') -- Exclude primary keys
ORDER BY t.table_name, c.column_name;

-- ==============================================
-- 3. ORPHAN RECORD DETECTION
-- ==============================================
\echo ''
\echo '3. ORPHAN RECORD DETECTION'
\echo '----------------------------------------'

-- Check specific critical relationships
SELECT 
    'daily_content_plans -> scheduled_posts' as relationship,
    COUNT(*) as orphan_count
FROM daily_content_plans dcp
WHERE dcp.scheduled_post_id IS NOT NULL
AND NOT EXISTS (
    SELECT 1 FROM scheduled_posts sp WHERE sp.id = dcp.scheduled_post_id
)
UNION ALL
SELECT 
    'queue_jobs -> scheduled_posts' as relationship,
    COUNT(*) as orphan_count
FROM queue_jobs qj
WHERE NOT EXISTS (
    SELECT 1 FROM scheduled_posts sp WHERE sp.id = qj.scheduled_post_id
)
UNION ALL
SELECT 
    'content_analytics -> scheduled_posts' as relationship,
    COUNT(*) as orphan_count
FROM content_analytics ca
WHERE NOT EXISTS (
    SELECT 1 FROM scheduled_posts sp WHERE sp.id = ca.scheduled_post_id
)
UNION ALL
SELECT 
    'scheduled_post_media -> scheduled_posts' as relationship,
    COUNT(*) as orphan_count
FROM scheduled_post_media spm
WHERE NOT EXISTS (
    SELECT 1 FROM scheduled_posts sp WHERE sp.id = spm.scheduled_post_id
)
UNION ALL
SELECT 
    'ai_content_analysis -> scheduled_posts' as relationship,
    COUNT(*) as orphan_count
FROM ai_content_analysis aca
WHERE NOT EXISTS (
    SELECT 1 FROM scheduled_posts sp WHERE sp.id = aca.scheduled_post_id
)
UNION ALL
SELECT 
    'scheduled_posts -> social_accounts' as relationship,
    COUNT(*) as orphan_count
FROM scheduled_posts sp
WHERE NOT EXISTS (
    SELECT 1 FROM social_accounts sa WHERE sa.id = sp.social_account_id
)
UNION ALL
SELECT 
    'scheduled_posts -> campaigns' as relationship,
    COUNT(*) as orphan_count
FROM scheduled_posts sp
WHERE sp.campaign_id IS NOT NULL
AND NOT EXISTS (
    SELECT 1 FROM campaigns c WHERE c.id = sp.campaign_id
)
UNION ALL
SELECT 
    'weekly_content_refinements -> campaigns' as relationship,
    COUNT(*) as orphan_count
FROM weekly_content_refinements wcr
WHERE NOT EXISTS (
    SELECT 1 FROM campaigns c WHERE c.id = wcr.campaign_id
)
UNION ALL
SELECT 
    'daily_content_plans -> campaigns' as relationship,
    COUNT(*) as orphan_count
FROM daily_content_plans dcp
WHERE NOT EXISTS (
    SELECT 1 FROM campaigns c WHERE c.id = dcp.campaign_id
);

-- ==============================================
-- 4. SCHEMA DIFF VERIFICATION
-- ==============================================
\echo ''
\echo '4. SCHEMA DIFF VERIFICATION'
\echo '----------------------------------------'

-- Expected tables from migration script
WITH expected_tables AS (
    SELECT unnest(ARRAY[
        'social_accounts',
        'content_templates',
        'scheduled_posts',
        'weekly_content_refinements',
        'daily_content_plans',
        'media_files',
        'scheduled_post_media',
        'queue_jobs',
        'queue_job_logs',
        'recurring_posts',
        'content_analytics',
        'platform_performance',
        'hashtag_performance',
        'ai_content_analysis',
        'optimal_posting_times',
        'audience_insights',
        'competitor_analysis',
        'roi_analysis',
        'notifications',
        'platform_configurations',
        'system_settings'
    ]) as table_name
),
existing_tables AS (
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_type = 'BASE TABLE'
)
SELECT
    CASE
        WHEN et.table_name IS NULL THEN '✗ MISSING'
        ELSE '✓ EXISTS'
    END as status,
    COALESCE(et.table_name, exp.table_name) as table_name
FROM expected_tables exp
LEFT JOIN existing_tables et ON exp.table_name = et.table_name
ORDER BY status, table_name;

-- Check expected columns in key tables
SELECT
    'scheduled_posts' as table_name,
    column_name,
    CASE
        WHEN EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'scheduled_posts' 
            AND column_name = cols.column_name
        ) THEN '✓ EXISTS'
        ELSE '✗ MISSING'
    END as status
FROM (VALUES
    ('id'), ('user_id'), ('social_account_id'), ('campaign_id'),
    ('platform'), ('content_type'), ('content'), ('scheduled_for'),
    ('status'), ('created_at'), ('updated_at')
) AS cols(column_name)
UNION ALL
SELECT
    'daily_content_plans' as table_name,
    column_name,
    CASE
        WHEN EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'daily_content_plans' 
            AND column_name = cols.column_name
        ) THEN '✓ EXISTS'
        ELSE '✗ MISSING'
    END as status
FROM (VALUES
    ('id'), ('campaign_id'), ('week_number'), ('date'),
    ('platform'), ('content_type'), ('scheduled_post_id'),
    ('marketing_channels'), ('existing_content'), ('content_notes')
) AS cols(column_name)
UNION ALL
SELECT
    'weekly_content_refinements' as table_name,
    column_name,
    CASE
        WHEN EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'weekly_content_refinements' 
            AND column_name = cols.column_name
        ) THEN '✓ EXISTS'
        ELSE '✗ MISSING'
    END as status
FROM (VALUES
    ('id'), ('campaign_id'), ('week_number'), ('theme'),
    ('focus_area'), ('marketing_channels'), ('existing_content'), ('content_notes')
) AS cols(column_name)
UNION ALL
SELECT
    'campaigns' as table_name,
    column_name,
    CASE
        WHEN EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'campaigns' 
            AND column_name = cols.column_name
        ) THEN '✓ EXISTS'
        ELSE '✗ MISSING'
    END as status
FROM (VALUES
    ('id'), ('user_id'), ('name'), ('start_date'), ('end_date'),
    ('key_messages'), ('success_metrics')
) AS cols(column_name)
ORDER BY table_name, column_name;

-- ==============================================
-- 5. CONSTRAINT NAMING CONSISTENCY
-- ==============================================
\echo ''
\echo '5. CONSTRAINT NAMING CONSISTENCY'
\echo '----------------------------------------'

-- Check foreign key constraint naming
SELECT
    CASE
        WHEN constraint_name LIKE '%_fkey' OR constraint_name LIKE 'fk_%' THEN '✓ CONSISTENT'
        ELSE '✗ INCONSISTENT'
    END as naming_status,
    table_name,
    constraint_name,
    constraint_type
FROM information_schema.table_constraints
WHERE table_schema = 'public'
AND constraint_type = 'FOREIGN KEY'
ORDER BY table_name, constraint_name;

-- Check for duplicate constraint names
SELECT
    CASE
        WHEN COUNT(*) > 1 THEN '✗ DUPLICATE'
        ELSE '✓ UNIQUE'
    END as uniqueness_status,
    constraint_name,
    COUNT(*) as occurrence_count,
    string_agg(table_name, ', ') as tables
FROM information_schema.table_constraints
WHERE table_schema = 'public'
GROUP BY constraint_name
HAVING COUNT(*) > 1
ORDER BY occurrence_count DESC;

-- ==============================================
-- 6. COMPOSITE INDEX RECOMMENDATIONS
-- ==============================================
\echo ''
\echo '6. COMPOSITE INDEX RECOMMENDATIONS'
\echo '----------------------------------------'

-- Suggest composite indexes for common query patterns
SELECT
    'RECOMMENDATION' as type,
    table_name,
    'CREATE INDEX IF NOT EXISTS idx_' || LOWER(table_name) || '_' || 
    string_agg(LOWER(column_name), '_') || 
    ' ON ' || table_name || '(' || string_agg(column_name, ', ') || ');' as recommended_index
FROM (
    SELECT 'daily_content_plans' as table_name, 'campaign_id' as column_name, 1 as priority
    UNION ALL SELECT 'daily_content_plans', 'date', 2
    UNION ALL SELECT 'daily_content_plans', 'platform', 3
    UNION ALL SELECT 'content_analytics', 'scheduled_post_id', 1
    UNION ALL SELECT 'content_analytics', 'analytics_date', 2
    UNION ALL SELECT 'platform_performance', 'user_id', 1
    UNION ALL SELECT 'platform_performance', 'date', 2
    UNION ALL SELECT 'platform_performance', 'platform', 3
    UNION ALL SELECT 'scheduled_posts', 'campaign_id', 1
    UNION ALL SELECT 'scheduled_posts', 'status', 2
    UNION ALL SELECT 'scheduled_posts', 'scheduled_for', 3
) AS index_candidates
WHERE NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE tablename = index_candidates.table_name
    AND indexdef LIKE '%' || index_candidates.column_name || '%'
    AND indexdef LIKE '%campaign_id%'
)
GROUP BY table_name
HAVING COUNT(*) >= 2
ORDER BY table_name;

-- ==============================================
-- SUMMARY REPORT
-- ==============================================
\echo ''
\echo '========================================'
\echo 'VALIDATION SUMMARY'
\echo '========================================'

DO $$
DECLARE
    fk_count INTEGER;
    orphan_total INTEGER := 0;
    missing_indexes INTEGER;
    missing_tables INTEGER;
    inconsistent_names INTEGER;
BEGIN
    -- Count foreign keys
    SELECT COUNT(*) INTO fk_count
    FROM information_schema.table_constraints
    WHERE constraint_type = 'FOREIGN KEY'
    AND table_schema = 'public';
    
    -- Check for orphan records (simplified check)
    SELECT COUNT(*) INTO orphan_total
    FROM (
        SELECT COUNT(*) FROM daily_content_plans dcp
        WHERE dcp.scheduled_post_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM scheduled_posts sp WHERE sp.id = dcp.scheduled_post_id)
        UNION ALL
        SELECT COUNT(*) FROM queue_jobs qj
        WHERE NOT EXISTS (SELECT 1 FROM scheduled_posts sp WHERE sp.id = qj.scheduled_post_id)
    ) orphans;
    
    -- Count missing tables
    SELECT COUNT(*) INTO missing_tables
    FROM (
        SELECT unnest(ARRAY[
            'social_accounts', 'content_templates', 'scheduled_posts',
            'weekly_content_refinements', 'daily_content_plans'
        ]) as table_name
    ) expected
    WHERE NOT EXISTS (
        SELECT 1 FROM information_schema.tables t
        WHERE t.table_name = expected.table_name
        AND t.table_schema = 'public'
    );
    
    RAISE NOTICE 'Foreign Keys: % found', fk_count;
    RAISE NOTICE 'Orphan Records: %', orphan_total;
    RAISE NOTICE 'Missing Tables: %', missing_tables;
    
    IF orphan_total = 0 AND missing_tables = 0 THEN
        RAISE NOTICE 'OVERALL: ✓ PASS';
    ELSE
        RAISE NOTICE 'OVERALL: ✗ FAIL - Review details above';
    END IF;
END $$;

\echo ''
\echo 'Validation complete. Review details above.'
\echo '========================================'


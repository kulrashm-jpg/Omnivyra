-- =============================================================================
-- AUDIT: Daily Execution / Daily Plan Tables
-- Run this to find any tables that might store daily execution data and cause
-- duplication or confusion. daily_content_plans is the ONLY canonical table.
-- =============================================================================

-- 1. List all tables with "daily" or "execution" in the name
SELECT 
  table_schema,
  table_name,
  (SELECT COUNT(*) FROM information_schema.columns c 
   WHERE c.table_schema = t.table_schema AND c.table_name = t.table_name) AS column_count
FROM information_schema.tables t
WHERE table_schema = 'public'
  AND (table_name ILIKE '%daily%' OR table_name ILIKE '%execution%')
ORDER BY table_name;

-- 2. Check for content_plans columns that might overlap with daily (weekly vs daily)
-- content_plans is WEEKLY-level; daily_content_plans is DAY-level. They serve different purposes.
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'content_plans'
  AND (column_name ILIKE '%daily%' OR column_name ILIKE '%day%' OR column_name ILIKE '%execution%')
ORDER BY ordinal_position;

-- 3. Row counts: how much data is in each daily-related table?
-- (Run each line separately if a table does not exist)
SELECT 'daily_content_plans' AS tbl, COUNT(*) AS row_count FROM daily_content_plans;
SELECT 'content_plans' AS tbl, COUNT(*) AS row_count FROM content_plans;

-- Optional — run only if these tables exist:
-- SELECT 'engagement_daily_digest' AS tbl, COUNT(*) FROM engagement_daily_digest;
-- SELECT 'campaign_execution_checkpoint' AS tbl, COUNT(*) FROM campaign_execution_checkpoint;

-- 4. Tables that REFERENCE daily_content_plans (not duplicates, just dependents)
SELECT 
  tc.table_name AS referencing_table,
  kcu.column_name,
  ccu.table_name AS referenced_table
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
WHERE ccu.table_name = 'daily_content_plans'
  AND tc.constraint_type = 'FOREIGN KEY';

-- 5. RECOMMENDATION: Only daily_content_plans should store daily execution items.
-- If you find another table writing daily plans (e.g. content_plans with day-level rows),
-- migrate data to daily_content_plans and stop writing to the duplicate.
-- 
-- SAFE TO IGNORE (different purpose):
-- - content_plans: weekly-level plans
-- - engagement_daily_digest: engagement summaries, not execution plans  
-- - campaign_execution_checkpoint: progress tracking, references daily_content_plans

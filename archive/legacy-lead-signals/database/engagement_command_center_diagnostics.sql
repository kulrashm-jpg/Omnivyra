-- =====================================================
-- Engagement Command Center — Data Validation Queries
-- Run in Supabase SQL Editor to verify pipeline health
-- =====================================================

-- Replace with your actual company_id for testing
-- SET @company_id = 'your-company-uuid-here';

-- 1. engagement_threads count by organization
SELECT
  organization_id,
  COUNT(*) as thread_count
FROM engagement_threads
WHERE organization_id IS NOT NULL
GROUP BY organization_id
ORDER BY thread_count DESC
LIMIT 20;

-- 2. engagement_messages total
SELECT COUNT(*) as message_count FROM engagement_messages;

-- 3. post_comments total (raw ingestion)
SELECT COUNT(*) as post_comment_count FROM post_comments;

-- 4. Sync health: post_comments present but engagement_threads empty?
-- If post_comments > 0 and engagement_threads = 0 for a company, sync may be broken
SELECT
  (SELECT COUNT(*) FROM post_comments) as post_comments_count,
  (SELECT COUNT(*) FROM engagement_threads) as engagement_threads_count;

-- 5. engagement_threads columns check (run to verify schema)
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'engagement_threads'
ORDER BY ordinal_position;

-- 6. Threads with NULL organization_id (ingestion mapping broken if many)
SELECT COUNT(*) as threads_with_null_org
FROM engagement_threads
WHERE organization_id IS NULL;

-- 7. Required tables existence
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'engagement_threads',
    'engagement_messages',
    'engagement_authors',
    'engagement_thread_classification',
    'engagement_thread_intelligence',
    'engagement_lead_signals',
    'engagement_message_intelligence',
    'engagement_opportunities',
    'post_comments',
    'scheduled_posts',
    'social_accounts'
  )
ORDER BY table_name;

-- =====================================================
-- ENGAGEMENT COMMAND CENTER — DATABASE VALIDATION
-- Run in Supabase SQL Editor to verify structure
-- =====================================================

-- Required tables (exist check)
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

-- engagement_threads required columns
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'engagement_threads'
  AND column_name IN ('id', 'organization_id', 'platform', 'ignored', 'priority_score', 'unread_count', 'created_at', 'updated_at')
ORDER BY column_name;

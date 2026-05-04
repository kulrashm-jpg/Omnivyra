-- =====================================================
-- LEAD THREAD RECOMPUTE QUEUE INDEX AUDIT
-- Run to inspect existing indexes after migrations
-- =====================================================

SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'lead_thread_recompute_queue'
ORDER BY indexname;

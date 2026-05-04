-- =====================================================
-- CONVERSATION MEMORY REBUILD QUEUE
-- Decouples memory rebuilds from ingestion pipeline.
-- Claim-before-delete: rows deleted only after successful updateThreadMemory.
-- claimed_at > 60s allows reclaim after worker crash.
-- Run after: engagement_thread_memory.sql
-- =====================================================

CREATE TABLE IF NOT EXISTS conversation_memory_rebuild_queue (
  thread_id UUID PRIMARY KEY REFERENCES engagement_threads(id) ON DELETE CASCADE,
  organization_id UUID,
  latest_message_id UUID REFERENCES engagement_messages(id) ON DELETE SET NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  claimed_at TIMESTAMPTZ
);

ALTER TABLE conversation_memory_rebuild_queue ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
ALTER TABLE conversation_memory_rebuild_queue ADD COLUMN IF NOT EXISTS latest_message_id UUID REFERENCES engagement_messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_memory_rebuild_queue_sched
  ON conversation_memory_rebuild_queue (scheduled_at);

CREATE INDEX IF NOT EXISTS idx_memory_rebuild_queue_claim
  ON conversation_memory_rebuild_queue (scheduled_at, claimed_at);

-- Claim rows (UPDATE claimed_at); worker deletes after successful updateThreadMemory
-- Drop required when changing return type (PostgreSQL does not allow CREATE OR REPLACE for that)
DROP FUNCTION IF EXISTS claim_conversation_memory_rebuild_batch(integer);
CREATE OR REPLACE FUNCTION claim_conversation_memory_rebuild_batch(p_limit INTEGER DEFAULT 20)
RETURNS TABLE (thread_id UUID, latest_message_id UUID)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH to_claim AS (
    SELECT q.thread_id
    FROM conversation_memory_rebuild_queue q
    WHERE q.scheduled_at <= now()
      AND (q.claimed_at IS NULL OR q.claimed_at <= now() - interval '60 seconds')
    ORDER BY q.scheduled_at ASC
    LIMIT p_limit
    FOR UPDATE OF q SKIP LOCKED
  )
  UPDATE conversation_memory_rebuild_queue q
  SET claimed_at = now()
  FROM to_claim c
  WHERE q.thread_id = c.thread_id
  RETURNING q.thread_id, q.latest_message_id;
END;
$$;

-- =====================================================
-- ENGAGEMENT THREAD MEMORY
-- Summarized conversation context per thread for AI reply generation.
-- Run after: engagement_unified_model.sql
-- =====================================================

CREATE TABLE IF NOT EXISTS engagement_thread_memory (
  thread_id UUID PRIMARY KEY REFERENCES engagement_threads(id) ON DELETE CASCADE,
  organization_id UUID,
  conversation_summary TEXT,
  last_message_id UUID REFERENCES engagement_messages(id) ON DELETE SET NULL,
  last_processed_message_id UUID REFERENCES engagement_messages(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE engagement_thread_memory ADD COLUMN IF NOT EXISTS last_processed_message_id UUID REFERENCES engagement_messages(id) ON DELETE SET NULL;

-- Index for bounded distance scan (thread_id, platform_created_at, id)
CREATE INDEX IF NOT EXISTS idx_engagement_messages_thread_time
  ON engagement_messages (thread_id, platform_created_at, id);

-- Index for latest message lookup (worker memory freshness check)
CREATE INDEX IF NOT EXISTS idx_engagement_messages_thread_latest
  ON engagement_messages (thread_id, platform_created_at DESC, id DESC);

-- Bounded existence check: distance_reached = true when >= 5 messages exist after last_processed
-- Uses LIMIT instead of COUNT(*) to stop scanning early
CREATE OR REPLACE FUNCTION get_engagement_thread_message_distance(p_thread_id UUID, p_last_processed_id UUID, p_threshold INTEGER DEFAULT 5)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  row_count INTEGER;
BEGIN
  IF p_last_processed_id IS NULL THEN
    SELECT COUNT(*) INTO row_count FROM (
      SELECT 1 FROM engagement_messages WHERE thread_id = p_thread_id
      ORDER BY platform_created_at, id
      LIMIT p_threshold
    ) t;
    RETURN row_count >= p_threshold;
  END IF;

  SELECT COUNT(*) INTO row_count FROM (
    SELECT 1 FROM engagement_messages em
    WHERE em.thread_id = p_thread_id
    AND (em.platform_created_at, em.id) > (
      SELECT e.platform_created_at, e.id FROM engagement_messages e
      WHERE e.id = p_last_processed_id AND e.thread_id = p_thread_id
    )
    ORDER BY em.platform_created_at, em.id
    LIMIT p_threshold
  ) t;
  RETURN row_count >= p_threshold;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_engagement_thread_memory_thread_id
  ON engagement_thread_memory (thread_id);

CREATE INDEX IF NOT EXISTS idx_engagement_thread_memory_organization_id
  ON engagement_thread_memory (organization_id);

-- Concurrency-safe upsert: lock thread row before update; sets last_processed_message_id
CREATE OR REPLACE FUNCTION upsert_engagement_thread_memory_locked(
  p_thread_id UUID,
  p_organization_id UUID,
  p_conversation_summary TEXT,
  p_last_message_id UUID,
  p_last_processed_message_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM 1 FROM engagement_threads WHERE id = p_thread_id FOR UPDATE;

  INSERT INTO engagement_thread_memory (thread_id, organization_id, conversation_summary, last_message_id, last_processed_message_id, updated_at)
  VALUES (p_thread_id, p_organization_id, p_conversation_summary, p_last_message_id, p_last_processed_message_id, now())
  ON CONFLICT (thread_id)
  DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    conversation_summary = EXCLUDED.conversation_summary,
    last_message_id = EXCLUDED.last_message_id,
    last_processed_message_id = EXCLUDED.last_processed_message_id,
    updated_at = now();
END;
$$;

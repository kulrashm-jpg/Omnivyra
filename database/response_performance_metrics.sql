-- =====================================================
-- RESPONSE PERFORMANCE METRICS
-- Response Learning Engine: track AI-generated reply performance.
-- Run after: engagement_unified_model.sql, engagement_lead_signals.sql
-- =====================================================

CREATE TABLE IF NOT EXISTS response_performance_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  thread_id UUID NOT NULL REFERENCES engagement_threads(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES engagement_messages(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  reply_type TEXT NOT NULL DEFAULT 'reply',
  ai_generated BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  engagement_like_count INTEGER NOT NULL DEFAULT 0,
  engagement_reply_count INTEGER NOT NULL DEFAULT 0,
  engagement_followup_count INTEGER NOT NULL DEFAULT 0,
  lead_conversion BOOLEAN NOT NULL DEFAULT false,
  evaluation_window_closed BOOLEAN NOT NULL DEFAULT false,
  evaluation_closed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_response_perf_org_created
  ON response_performance_metrics (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_response_perf_thread
  ON response_performance_metrics (thread_id);

CREATE INDEX IF NOT EXISTS idx_response_perf_message
  ON response_performance_metrics (message_id);

CREATE INDEX IF NOT EXISTS idx_response_perf_eval_open
  ON response_performance_metrics (evaluation_window_closed, created_at)
  WHERE evaluation_window_closed = false;

-- Atomic increment: engagement_like_count (single SQL, safe under concurrency)
CREATE OR REPLACE FUNCTION increment_response_perf_like(p_liked_message_id UUID)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_parent_id UUID;
BEGIN
  SELECT parent_message_id INTO v_parent_id
  FROM engagement_messages WHERE id = p_liked_message_id;
  IF v_parent_id IS NULL THEN RETURN; END IF;

  UPDATE response_performance_metrics
  SET engagement_like_count = engagement_like_count + 1
  WHERE id = (
    SELECT id FROM response_performance_metrics
    WHERE message_id = v_parent_id
    ORDER BY created_at DESC
    LIMIT 1
  );
END;
$$;

-- Atomic increment: engagement_reply_count (single SQL, safe under concurrency)
CREATE OR REPLACE FUNCTION increment_response_perf_followup(
  p_thread_id UUID,
  p_new_message_platform_created_at TIMESTAMPTZ
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE response_performance_metrics
  SET engagement_reply_count = engagement_reply_count + 1
  WHERE id = (
    SELECT id FROM response_performance_metrics
    WHERE thread_id = p_thread_id
    AND created_at < p_new_message_platform_created_at
    AND evaluation_window_closed = false
    ORDER BY created_at DESC
    LIMIT 1
  );
END;
$$;

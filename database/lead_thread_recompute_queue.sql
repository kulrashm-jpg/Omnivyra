-- =====================================================
-- LEAD THREAD RECOMPUTE QUEUE
-- Database-backed debounce guard for thread score recompute.
-- Multi-instance safe: only one worker processes each thread.
-- =====================================================
-- Run after: engagement_threads, engagement_lead_signals
-- =====================================================

CREATE TABLE IF NOT EXISTS lead_thread_recompute_queue (
  thread_id UUID NOT NULL REFERENCES engagement_threads(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '5 seconds'),
  PRIMARY KEY (thread_id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_lead_thread_recompute_queue_scheduled
  ON lead_thread_recompute_queue(scheduled_at);

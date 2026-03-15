-- =====================================================
-- ENGAGEMENT THREAD IGNORED
-- Allow users to ignore threads from inbox
-- Run after: engagement_unified_model.sql
-- =====================================================

ALTER TABLE engagement_threads
  ADD COLUMN IF NOT EXISTS ignored BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_engagement_threads_ignored
  ON engagement_threads (ignored)
  WHERE organization_id IS NOT NULL;

-- =====================================================
-- PHASE 2: ENGAGEMENT INBOX EXTENSIONS
-- Adds priority_score, unread_count to engagement_threads.
-- Run after: engagement_unified_model.sql
-- =====================================================

ALTER TABLE engagement_threads
  ADD COLUMN IF NOT EXISTS priority_score NUMERIC DEFAULT 0;

ALTER TABLE engagement_threads
  ADD COLUMN IF NOT EXISTS unread_count INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_engagement_threads_priority
  ON engagement_threads(priority_score DESC NULLS LAST)
  WHERE organization_id IS NOT NULL;

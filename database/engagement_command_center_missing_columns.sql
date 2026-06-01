-- =====================================================
-- ENGAGEMENT COMMAND CENTER — FIX MISSING COLUMNS
-- Run if engagement_threads is missing ignored, priority_score, unread_count
-- Depends on: engagement_unified_model.sql
-- =====================================================

-- Phase 2 extensions (priority_score, unread_count)
ALTER TABLE engagement_threads
  ADD COLUMN IF NOT EXISTS priority_score NUMERIC DEFAULT 0;

ALTER TABLE engagement_threads
  ADD COLUMN IF NOT EXISTS unread_count INTEGER DEFAULT 0;

-- Thread ignored
ALTER TABLE engagement_threads
  ADD COLUMN IF NOT EXISTS ignored BOOLEAN NOT NULL DEFAULT false;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_engagement_threads_priority
  ON engagement_threads(priority_score DESC NULLS LAST)
  WHERE organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_engagement_threads_ignored
  ON engagement_threads (ignored)
  WHERE organization_id IS NOT NULL;

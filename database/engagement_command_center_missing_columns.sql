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

-- Collaboration layer (Batch 2): assignment, ignore attribution, reply soft-lock.
-- See supabase/migrations/20260819_engagement_collaboration_layer.sql.
ALTER TABLE engagement_threads
  ADD COLUMN IF NOT EXISTS assigned_to            UUID,
  ADD COLUMN IF NOT EXISTS assigned_by            UUID,
  ADD COLUMN IF NOT EXISTS assigned_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ignored_by             UUID,
  ADD COLUMN IF NOT EXISTS reply_lock_user_id     UUID,
  ADD COLUMN IF NOT EXISTS reply_lock_expires_at  TIMESTAMPTZ;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_engagement_threads_priority
  ON engagement_threads(priority_score DESC NULLS LAST)
  WHERE organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_engagement_threads_ignored
  ON engagement_threads (ignored)
  WHERE organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_engagement_threads_assigned_to
  ON engagement_threads (organization_id, assigned_to);

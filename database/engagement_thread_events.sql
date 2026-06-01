-- =====================================================
-- ENGAGEMENT THREAD EVENTS — collaboration activity timeline
-- Batch 2 multi-user collaboration foundation.
-- Canonical mirror of supabase/migrations/20260819_engagement_collaboration_layer.sql
-- =====================================================

CREATE TABLE IF NOT EXISTS engagement_thread_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  thread_id       UUID NOT NULL,
  actor_user_id   UUID,
  event_type      TEXT NOT NULL,   -- assigned | unassigned | replied | resolved | ignored | unignored
  detail          JSONB DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_engagement_thread_events_thread
  ON engagement_thread_events (organization_id, thread_id, created_at DESC);

ALTER TABLE engagement_thread_events ENABLE ROW LEVEL SECURITY;
GRANT ALL ON engagement_thread_events TO service_role;

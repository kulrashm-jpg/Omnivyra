-- =====================================================
-- LEAD THREAD SCORE CACHE
-- Stores last known thread_lead_score to avoid unnecessary
-- recompute scheduling when score has not changed.
-- =====================================================
-- Run after: engagement_threads, lead_thread_recompute_queue
-- =====================================================

CREATE TABLE IF NOT EXISTS lead_thread_score_cache (
  thread_id UUID NOT NULL REFERENCES engagement_threads(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  thread_lead_score INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (thread_id, organization_id)
);

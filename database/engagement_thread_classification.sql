-- =====================================================
-- ENGAGEMENT THREAD CLASSIFICATION
-- AI triage: classification_category, sentiment, triage_priority
-- Run after: engagement_unified_model.sql
-- =====================================================

CREATE TABLE IF NOT EXISTS engagement_thread_classification (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  thread_id UUID NOT NULL REFERENCES engagement_threads(id) ON DELETE CASCADE,
  classification_category TEXT NOT NULL,
  classification_confidence NUMERIC,
  sentiment TEXT,
  triage_priority INTEGER DEFAULT 0,
  classified_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_thread_classification_thread
  ON engagement_thread_classification(thread_id);

CREATE INDEX IF NOT EXISTS idx_thread_classification_org
  ON engagement_thread_classification(organization_id);

CREATE INDEX IF NOT EXISTS idx_thread_classification_priority
  ON engagement_thread_classification(triage_priority DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_thread_classification_thread_org
  ON engagement_thread_classification(thread_id, organization_id);

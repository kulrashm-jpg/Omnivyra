-- =====================================================
-- PHASE 3: THREAD INTELLIGENCE
-- Aggregated intelligence per engagement thread
-- =====================================================
-- Run after: engagement_message_intelligence.sql
-- =====================================================

CREATE TABLE IF NOT EXISTS engagement_thread_intelligence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES engagement_threads(id) ON DELETE CASCADE,
  dominant_intent TEXT,
  lead_detected BOOLEAN DEFAULT FALSE,
  negative_feedback BOOLEAN DEFAULT FALSE,
  customer_question BOOLEAN DEFAULT FALSE,
  influencer_detected BOOLEAN DEFAULT FALSE,
  priority_reason TEXT,
  confidence_score NUMERIC,
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT engagement_thread_intelligence_thread_unique UNIQUE (thread_id)
);

CREATE INDEX IF NOT EXISTS idx_engagement_thread_intelligence_thread
  ON engagement_thread_intelligence(thread_id);

CREATE INDEX IF NOT EXISTS idx_engagement_thread_intelligence_lead
  ON engagement_thread_intelligence(lead_detected)
  WHERE lead_detected = TRUE;

CREATE INDEX IF NOT EXISTS idx_engagement_thread_intelligence_negative
  ON engagement_thread_intelligence(negative_feedback)
  WHERE negative_feedback = TRUE;

-- =====================================================
-- PHASE 3: MESSAGE INTELLIGENCE
-- Intelligence signals per engagement message
-- =====================================================
-- Run after: engagement_unified_model.sql
-- =====================================================

CREATE TABLE IF NOT EXISTS engagement_message_intelligence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES engagement_messages(id) ON DELETE CASCADE,
  sentiment TEXT,
  intent TEXT,
  lead_signal BOOLEAN DEFAULT FALSE,
  question_detected BOOLEAN DEFAULT FALSE,
  influencer_signal BOOLEAN DEFAULT FALSE,
  confidence_score NUMERIC,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_engagement_message_intelligence_message
  ON engagement_message_intelligence(message_id);

CREATE INDEX IF NOT EXISTS idx_engagement_message_intelligence_intent
  ON engagement_message_intelligence(intent);

CREATE INDEX IF NOT EXISTS idx_engagement_message_intelligence_sentiment
  ON engagement_message_intelligence(sentiment);

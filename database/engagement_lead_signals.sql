-- =====================================================
-- LEAD INTELLIGENCE ENGINE
-- Per-message lead signals from engagement conversations
-- =====================================================
-- Run after: engagement_messages, companies
-- =====================================================

CREATE TABLE IF NOT EXISTS engagement_lead_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES engagement_messages(id) ON DELETE CASCADE,
  thread_id UUID NOT NULL REFERENCES engagement_threads(id) ON DELETE CASCADE,
  author_id UUID REFERENCES engagement_authors(id) ON DELETE SET NULL,
  lead_intent TEXT NOT NULL,
  lead_score INTEGER NOT NULL DEFAULT 0,
  confidence_score NUMERIC,
  detected_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_engagement_lead_signals_thread
  ON engagement_lead_signals(thread_id);

CREATE INDEX IF NOT EXISTS idx_engagement_lead_signals_organization
  ON engagement_lead_signals(organization_id);

CREATE INDEX IF NOT EXISTS idx_engagement_lead_signals_lead_score
  ON engagement_lead_signals(lead_score DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_engagement_lead_signals_message
  ON engagement_lead_signals(message_id);

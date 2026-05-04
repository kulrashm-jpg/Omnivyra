-- =====================================================
-- ENGAGEMENT SYSTEM CONTROLS
-- Governance controls for automation and AI behavior.
-- =====================================================

CREATE TABLE IF NOT EXISTS engagement_system_controls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  auto_reply_enabled BOOLEAN NOT NULL DEFAULT true,
  bulk_reply_enabled BOOLEAN NOT NULL DEFAULT true,
  ai_suggestions_enabled BOOLEAN NOT NULL DEFAULT true,
  triage_engine_enabled BOOLEAN NOT NULL DEFAULT true,
  opportunity_detection_enabled BOOLEAN NOT NULL DEFAULT true,
  response_strategy_learning_enabled BOOLEAN NOT NULL DEFAULT true,
  digest_generation_enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_engagement_controls_org
  ON engagement_system_controls (organization_id);

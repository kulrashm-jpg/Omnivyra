-- =====================================================
-- OMNIVYRA AI RESPONSE ENGINE: RULES
-- Maps intent + platform to template
-- =====================================================
-- Run after: response_templates.sql
-- =====================================================

CREATE TABLE IF NOT EXISTS response_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  platform TEXT,
  intent_type TEXT NOT NULL,
  template_id UUID NOT NULL REFERENCES response_templates(id) ON DELETE CASCADE,
  auto_reply BOOLEAN DEFAULT FALSE,
  priority INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_response_rules_org_platform_intent
  ON response_rules(organization_id, platform, intent_type);

CREATE INDEX IF NOT EXISTS idx_response_rules_priority
  ON response_rules(priority DESC);

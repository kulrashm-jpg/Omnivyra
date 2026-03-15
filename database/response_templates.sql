-- =====================================================
-- OMNIVYRA AI RESPONSE ENGINE: TEMPLATES
-- Tagged response templates for LLM generation
-- =====================================================
-- Run after: companies (organization_id)
-- =====================================================

CREATE TABLE IF NOT EXISTS response_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  template_name TEXT NOT NULL,
  platform TEXT,
  template_structure TEXT NOT NULL,
  tone TEXT DEFAULT 'professional',
  emoji_policy TEXT DEFAULT 'minimal',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_response_templates_org
  ON response_templates(organization_id);

CREATE INDEX IF NOT EXISTS idx_response_templates_platform
  ON response_templates(platform)
  WHERE platform IS NOT NULL;

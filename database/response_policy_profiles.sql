-- =====================================================
-- OMNIVYRA AI RESPONSE ENGINE: POLICY PROFILES
-- Per-platform default tone and style
-- =====================================================
-- Run after: companies
-- =====================================================

CREATE TABLE IF NOT EXISTS response_policy_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  default_tone TEXT DEFAULT 'professional',
  emoji_usage TEXT DEFAULT 'minimal',
  response_style TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(organization_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_response_policy_profiles_org_platform
  ON response_policy_profiles(organization_id, platform);

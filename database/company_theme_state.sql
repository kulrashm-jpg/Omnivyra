-- =====================================================
-- COMPANY THEME STATE
-- Lifecycle tracking for strategic themes per company.
-- AVAILABLE = may appear in recommendations
-- IN_USE = campaign created from theme, not completed
-- CONSUMED = campaign completed successfully, never show again
-- DISMISSED = user dismissed, do not show again
-- =====================================================
-- Run after: campaigns, campaign_versions, companies
-- =====================================================

CREATE TABLE IF NOT EXISTS company_theme_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  theme_topic TEXT NOT NULL,
  theme_key TEXT NOT NULL DEFAULT '',
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  state TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (state IN ('AVAILABLE', 'IN_USE', 'CONSUMED', 'DISMISSED')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Migration: add theme_key if table exists without it
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'company_theme_state' AND column_name = 'theme_key') THEN
    ALTER TABLE company_theme_state ADD COLUMN theme_key TEXT;
    UPDATE company_theme_state
    SET theme_key = LOWER(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(theme_topic, ''), '[^\w\s]', '', 'g'), '\s+', ' ', 'g')))
    WHERE theme_key IS NULL OR theme_key = '';
    ALTER TABLE company_theme_state ALTER COLUMN theme_key SET NOT NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS index_company_theme_state_company
  ON company_theme_state(company_id);

CREATE INDEX IF NOT EXISTS index_company_theme_state_campaign
  ON company_theme_state(campaign_id);

CREATE INDEX IF NOT EXISTS index_company_theme_state_company_state
  ON company_theme_state(company_id, state);

CREATE UNIQUE INDEX IF NOT EXISTS index_company_theme_state_company_topic
  ON company_theme_state(company_id, theme_topic);

CREATE INDEX IF NOT EXISTS index_company_theme_state_company_key
  ON company_theme_state(company_id, theme_key);

-- =====================================================
-- COMPANY STRATEGIC THEMES
-- Phase 4: Persistent themes derived from opportunities
-- =====================================================
-- Run after: companies (must exist)
-- =====================================================

CREATE TABLE IF NOT EXISTS company_strategic_themes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  theme_topic TEXT NOT NULL,
  theme_strength NUMERIC NULL,
  supporting_signals JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS index_company_strategic_themes_company
  ON company_strategic_themes (company_id);

CREATE INDEX IF NOT EXISTS index_company_strategic_themes_strength
  ON company_strategic_themes (company_id, theme_strength DESC NULLS LAST);

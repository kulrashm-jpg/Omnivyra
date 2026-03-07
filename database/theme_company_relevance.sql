-- =====================================================
-- THEME COMPANY RELEVANCE
-- Scores how relevant each strategic theme is per company
-- (industry, keywords, competitors). Used to filter themes for UI.
-- =====================================================
-- Run after: strategic_themes.sql, companies / company_profiles
-- =====================================================

CREATE TABLE IF NOT EXISTS theme_company_relevance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  theme_id UUID NOT NULL REFERENCES strategic_themes(id) ON DELETE CASCADE,
  relevance_score NUMERIC NOT NULL,
  matched_keywords JSONB DEFAULT '[]'::jsonb,
  matched_companies JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT theme_company_relevance_company_theme_unique UNIQUE (company_id, theme_id)
);

CREATE INDEX IF NOT EXISTS index_theme_company_relevance_company
  ON theme_company_relevance (company_id);

CREATE INDEX IF NOT EXISTS index_theme_company_relevance_theme
  ON theme_company_relevance (theme_id);

CREATE INDEX IF NOT EXISTS index_theme_company_relevance_score
  ON theme_company_relevance (company_id, relevance_score DESC NULLS LAST);

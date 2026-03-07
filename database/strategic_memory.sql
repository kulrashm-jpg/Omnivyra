-- =====================================================
-- STRATEGIC MEMORY
-- Phase 4: Long-term intelligence storage
-- =====================================================
-- Run after: company_strategic_themes (must exist)
-- =====================================================

CREATE TABLE IF NOT EXISTS strategic_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  theme_id UUID NULL REFERENCES company_strategic_themes(id) ON DELETE SET NULL,
  memory_type TEXT NOT NULL,
  confidence NUMERIC NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS index_strategic_memory_company
  ON strategic_memory (company_id);

CREATE INDEX IF NOT EXISTS index_strategic_memory_theme
  ON strategic_memory (theme_id)
  WHERE theme_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS index_strategic_memory_created
  ON strategic_memory (company_id, created_at DESC);

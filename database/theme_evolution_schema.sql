-- =====================================================
-- THEME EVOLUTION SCHEMA
-- Phase 6: Add archived_at for theme evolution engine
-- =====================================================
-- Run after: company_strategic_themes (must exist)
-- =====================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'company_strategic_themes' AND column_name = 'archived_at'
  ) THEN
    ALTER TABLE company_strategic_themes
      ADD COLUMN archived_at TIMESTAMPTZ NULL;
  END IF;
END $$;

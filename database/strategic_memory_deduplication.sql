-- =====================================================
-- STRATEGIC MEMORY DEDUPLICATION
-- Phase 5: Prevent strategic memory inflation
-- =====================================================
-- Run after: strategic_memory (must exist)
-- =====================================================

-- Add effective theme (NULL -> sentinel) for unique constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'strategic_memory' AND column_name = 'theme_id_effective'
  ) THEN
    ALTER TABLE strategic_memory
      ADD COLUMN theme_id_effective UUID GENERATED ALWAYS AS (
        COALESCE(theme_id, '00000000-0000-0000-0000-000000000000'::uuid)
      ) STORED;
  END IF;
END $$;

ALTER TABLE strategic_memory
  DROP CONSTRAINT IF EXISTS strategic_memory_company_theme_type_key;
ALTER TABLE strategic_memory
  ADD CONSTRAINT strategic_memory_company_theme_type_key
  UNIQUE (company_id, theme_id_effective, memory_type);

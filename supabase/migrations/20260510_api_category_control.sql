-- ============================================================
-- API Category Control Layer
-- Formalises categories, adds global enable flag, locks tenant APIs.
-- ============================================================

-- ── 1. is_enabled_global — SuperAdmin kill-switch per API source ──────────────
ALTER TABLE external_api_sources
  ADD COLUMN IF NOT EXISTS is_enabled_global BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_ext_api_sources_enabled_global
  ON external_api_sources(is_enabled_global) WHERE is_enabled_global = false;

-- ── 2. Normalise existing category values before adding constraint ────────────
-- Anything that is not one of the four valid values gets set to 'others'.
UPDATE external_api_sources
SET category = 'others'
WHERE category IS NOT NULL
  AND category NOT IN ('trend', 'community', 'image', 'others');

-- ── 3. Category CHECK constraint ─────────────────────────────────────────────
-- NULL is allowed (platform APIs created before categorisation).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_ext_api_category'
      AND conrelid = 'external_api_sources'::regclass
  ) THEN
    ALTER TABLE external_api_sources
      ADD CONSTRAINT chk_ext_api_category
        CHECK (category IS NULL OR category IN ('trend', 'community', 'image', 'others'));
  END IF;
END$$;

-- ── 4. Lock down tenant-created (non-preset) APIs ────────────────────────────
-- These were created by individual companies and are outside platform control.
-- Force them to category='others' and strip the whitelist flag so they are
-- skipped in all execution flows until a SuperAdmin explicitly re-whitelists.
UPDATE external_api_sources
SET
  category      = 'others',
  is_whitelisted = false
WHERE company_id IS NOT NULL
  AND (is_preset = false OR is_preset IS NULL);

-- Preset APIs (is_preset = true) are always kept as-is regardless of company_id.

-- ── 5. Others category must be whitelisted to be usable ──────────────────────
-- Document the invariant in a DB-level CHECK for future inserts.
-- Existing rows where others+not-whitelisted are intentionally left (locked APIs).
-- The application layer enforces this on create/update; here it is advisory only.
-- (A strict CHECK would prevent SuperAdmin from creating 'others' + false pairs,
--  which are valid for the "locked" state, so we enforce at app layer only.)

-- ── 6. Ensure preset APIs keep is_enabled_global = true ──────────────────────
UPDATE external_api_sources
SET is_enabled_global = true
WHERE is_preset = true;

COMMENT ON COLUMN external_api_sources.is_enabled_global IS
  'SuperAdmin global kill-switch. false = skipped in all execution flows regardless of other settings.';

COMMENT ON COLUMN external_api_sources.is_whitelisted IS
  'Required to be true for category=others APIs to appear in execution flows. Set by SuperAdmin only.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Mark company_domains.domain as DEPRECATED.
--
-- Reads have been migrated to final_domain across the codebase. Writes still
-- populate `domain` via saveDomainRecord (so any unmigrated consumer keeps
-- working) but the column will be dropped in a future migration once the
-- one-shot canonical backfill (scripts/backfillCanonicalDomains.ts) has run
-- and the dry-check for UNIQUE(final_domain) is clean.
--
-- This migration is metadata-only — no schema mutation, no data change.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- Re-runnable: skip if the column has already been dropped by 20260612.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'company_domains'
      AND column_name  = 'domain'
  ) THEN
    EXECUTE $cmt$
      COMMENT ON COLUMN company_domains.domain IS
        'DEPRECATED - do not read from this column. Use final_domain instead. '
        'Writes still populate it via saveDomainRecord() for backward compatibility. '
        'Will be dropped after the canonical backfill (scripts/backfillCanonicalDomains.ts) '
        'completes and UNIQUE(final_domain) is added.'
    $cmt$;
  END IF;
END $$;

COMMIT;

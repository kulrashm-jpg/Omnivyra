-- ─────────────────────────────────────────────────────────────────────────────
-- Lock the canonical contract on company_domains:
--   1. UNIQUE(final_domain) — one canonical domain per row
--   2. NOT NULL final_domain — every row must carry a canonical key
--
-- Pre-condition: scripts/backfillCanonicalDomains.ts has been run with
--                collisions_found = 0 and ready_for_unique_constraint = true.
--
-- Post-condition: cross-company canonical reuse is structurally impossible.
-- Reads are deterministic (one row per final_domain). saveDomainRecord's
-- claim-check + reassignDomain remain the only paths for change.
--
-- Applied to live database via mcp__supabase__apply_migration on 2026-05-01.
-- This file mirrors the live state so the repo's migration history stays
-- aligned with production.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- Re-runnable: only add the UNIQUE constraint if it isn't already in place.
-- The DROP-then-ADD pattern would also work but causes an unnecessary index
-- rebuild; gating the ADD avoids touching the index entirely on a re-run.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname  = 'unique_final_domain'
      AND conrelid = 'public.company_domains'::regclass
  ) THEN
    ALTER TABLE company_domains
      ADD CONSTRAINT unique_final_domain UNIQUE (final_domain);
  END IF;
END $$;

-- SET NOT NULL is idempotent — a no-op if final_domain is already NOT NULL.
ALTER TABLE company_domains
  ALTER COLUMN final_domain SET NOT NULL;

COMMIT;

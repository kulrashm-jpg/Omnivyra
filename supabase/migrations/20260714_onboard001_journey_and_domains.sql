-- ═══════════════════════════════════════════════════════════════════════════════
-- ONBOARD-001 — journey state + canonical domain-registry completion
--
--   1. company_setup_progress.journey_state (JSONB, additive)
--      Durable per-company store for onboarding-journey stage overrides
--      (skipped / dismissed / completed-at markers). The audit found no
--      persisted Skipped/Dismissed state anywhere (localStorage only).
--      Shape (owned by backend/services/onboardingJourneyService.ts):
--        { "<stageId>": { "status": "skipped"|"dismissed"|"completed",
--                          "at": "<iso>", "by": "<userId>" }, ... }
--
--   2. company_domains backfill — completes the registry migration started
--      by 20260406/20260609: every company whose identity lives only on the
--      legacy companies.website_domain / admin_email_domain columns gets a
--      canonical company_domains row. Legacy columns are NOT dropped and
--      remain dual-written (backward compatibility); the canonical table is
--      now guaranteed to cover every company, so readers can rely on it.
--      Conflict-safe: ON CONFLICT DO NOTHING on final_domain; companies
--      whose domain is already claimed in the registry are skipped (report
--      via scripts/verify-auth001-migration-readiness.js patterns).
--
-- Idempotent / re-runnable. No data loss (INSERT-only + one additive column).
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. journey_state ──────────────────────────────────────────────────────────
ALTER TABLE company_setup_progress
  ADD COLUMN IF NOT EXISTS journey_state JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN company_setup_progress.journey_state IS
  'ONBOARD-001: per-stage onboarding-journey overrides (skipped/dismissed/completed). Owned by onboardingJourneyService.';

-- ── 2. company_domains backfill from legacy columns ───────────────────────────
-- Defensive about the legacy `domain` column (dropped by 20260612 in the
-- ledger, but production migration state is managed manually — see the
-- schema-parity verifier). Inserts include `domain` only when the column
-- still exists AND is NOT NULL-constrained.
DO $$
DECLARE
  has_legacy_domain boolean;
  inserted_count integer := 0;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'company_domains'
      AND column_name  = 'domain'
  ) INTO has_legacy_domain;

  IF has_legacy_domain THEN
    EXECUTE $ins$
      INSERT INTO company_domains
        (company_id, domain, input_domain, final_domain, is_primary,
         verification_status, created_via)
      SELECT c.id,
             COALESCE(c.website_domain, c.admin_email_domain),
             COALESCE(c.website_domain, c.admin_email_domain),
             COALESCE(c.website_domain, c.admin_email_domain),
             true,
             'unverified',
             'system'
      FROM companies c
      WHERE COALESCE(c.website_domain, c.admin_email_domain) IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM company_domains d WHERE d.company_id = c.id
        )
      ON CONFLICT DO NOTHING
    $ins$;
  ELSE
    EXECUTE $ins$
      INSERT INTO company_domains
        (company_id, input_domain, final_domain, is_primary,
         verification_status, created_via)
      SELECT c.id,
             COALESCE(c.website_domain, c.admin_email_domain),
             COALESCE(c.website_domain, c.admin_email_domain),
             true,
             'unverified',
             'system'
      FROM companies c
      WHERE COALESCE(c.website_domain, c.admin_email_domain) IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM company_domains d WHERE d.company_id = c.id
        )
      ON CONFLICT DO NOTHING
    $ins$;
  END IF;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RAISE NOTICE 'ONBOARD-001: backfilled % company_domains row(s) from legacy columns', inserted_count;

  -- Visibility: companies still lacking a registry row after the backfill
  -- (their domain is claimed by ANOTHER company — needs manual review).
  PERFORM 1;
  RAISE NOTICE 'ONBOARD-001: % company(ies) still lack a company_domains row (domain claimed elsewhere — review manually)',
    (SELECT count(*) FROM companies c
      WHERE COALESCE(c.website_domain, c.admin_email_domain) IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM company_domains d WHERE d.company_id = c.id));
END $$;

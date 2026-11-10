-- ROLLBACK for 20270209000000_data_source_usage_ledger.sql
--
-- Drops prospect_capture_runs, then the usage constraints and columns added to
-- the two attempt tables. LOSSY: every recorded capture total, funding source,
-- vendor-unit count (enrichment only), credits-charged figure, initiator and
-- screening count is erased. The attempt rows themselves, and
-- prospect_discovery_attempts.provider_cost_units (which predates this
-- migration), are untouched. Grants nothing back.
--
-- Run only after the application code that writes these columns is gone or the
-- usage write is disabled (it is best-effort and tolerates missing columns).

BEGIN;

DROP TABLE IF EXISTS public.prospect_capture_runs;

ALTER TABLE public.prospect_enrichment_attempts
  DROP CONSTRAINT IF EXISTS pea_funding_valid,
  DROP CONSTRAINT IF EXISTS pea_cost_units_nonnegative,
  DROP CONSTRAINT IF EXISTS pea_credits_nonnegative,
  DROP CONSTRAINT IF EXISTS pea_tenant_funding_uncharged,
  DROP COLUMN IF EXISTS provider_cost_units,
  DROP COLUMN IF EXISTS funding,
  DROP COLUMN IF EXISTS credits_charged,
  DROP COLUMN IF EXISTS initiated_by;

ALTER TABLE public.prospect_discovery_attempts
  DROP CONSTRAINT IF EXISTS pda_funding_valid,
  DROP CONSTRAINT IF EXISTS pda_credits_nonnegative,
  DROP CONSTRAINT IF EXISTS pda_tenant_funding_uncharged,
  DROP CONSTRAINT IF EXISTS pda_screening_nonnegative,
  DROP CONSTRAINT IF EXISTS pda_screening_within_observed,
  DROP COLUMN IF EXISTS funding,
  DROP COLUMN IF EXISTS credits_charged,
  DROP COLUMN IF EXISTS initiated_by,
  DROP COLUMN IF EXISTS results_skipped_duplicate,
  DROP COLUMN IF EXISTS results_held_for_review,
  DROP COLUMN IF EXISTS results_probe_unknown;

DO $verify$
BEGIN
  IF to_regclass('public.prospect_capture_runs') IS NOT NULL THEN
    RAISE EXCEPTION 'usage rollback postcondition: prospect_capture_runs still exists';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
             AND ((table_name = 'prospect_enrichment_attempts'
                   AND column_name IN ('provider_cost_units','funding','credits_charged','initiated_by'))
               OR (table_name = 'prospect_discovery_attempts'
                   AND column_name IN ('funding','credits_charged','initiated_by','results_skipped_duplicate',
                                       'results_held_for_review','results_probe_unknown')))) THEN
    RAISE EXCEPTION 'usage rollback postcondition: a usage column survived';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                 AND table_name = 'prospect_discovery_attempts' AND column_name = 'provider_cost_units') THEN
    RAISE EXCEPTION 'usage rollback postcondition: pre-existing discovery provider_cost_units was dropped';
  END IF;
  -- The pre-existing discovery CHECKs (C1, 2026-11-10) must survive: this file
  -- drops only the pda_* constraints 20270209000000 added.
  IF (SELECT count(*) FROM pg_constraint
       WHERE conrelid = 'public.prospect_discovery_attempts'::regclass AND contype = 'c'
         AND (conname LIKE '%ingested_within_observed' OR conname LIKE '%cost_units_consistent'
              OR conname LIKE '%cost_units_nonnegative' OR conname LIKE '%cost_state_valid')) <> 4 THEN
    RAISE EXCEPTION 'usage rollback postcondition: a pre-existing discovery CHECK is missing';
  END IF;
END
$verify$;

COMMIT;

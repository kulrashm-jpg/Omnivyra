-- 20270209000001 data_source_usage_validate (reserved by virality-83, 7948a1a29, 2026-11-11)
--
-- Second step of 20270209000000_data_source_usage_ledger (PI review,
-- 2026-11-11). That migration added nine CHECKs to two APPLIED, growing tables
-- (prospect_enrichment_attempts, prospect_discovery_attempts) as NOT VALID, so
-- its transaction (ACCESS EXCLUSIVE from ADD COLUMN, held to COMMIT) scanned
-- nothing. This file validates them in a SEPARATE transaction: VALIDATE
-- CONSTRAINT takes SHARE UPDATE EXCLUSIVE, so reads and writes continue while
-- existing rows are scanned.
--
-- Every existing row passes: the new columns are NULL on every pre-existing
-- row, so each CHECK is satisfied by its NULL branch, and the coalesce sum in
-- pda_screening_within_observed reduces to results_ingested <= results_observed,
-- which the pre-existing ingested_within_observed already guarantees.
--
-- MUST be applied after 20270209000000 and as its own migration (own
-- transaction). Idempotent: validating a valid constraint is a no-op.
-- No new object, so no grant moves. Rollback: nothing to undo (a validated
-- constraint is dropped by 20270209000000's rollback).

BEGIN;

ALTER TABLE public.prospect_enrichment_attempts VALIDATE CONSTRAINT pea_funding_valid;
ALTER TABLE public.prospect_enrichment_attempts VALIDATE CONSTRAINT pea_cost_units_nonnegative;
ALTER TABLE public.prospect_enrichment_attempts VALIDATE CONSTRAINT pea_credits_nonnegative;
ALTER TABLE public.prospect_enrichment_attempts VALIDATE CONSTRAINT pea_tenant_funding_uncharged;

ALTER TABLE public.prospect_discovery_attempts VALIDATE CONSTRAINT pda_funding_valid;
ALTER TABLE public.prospect_discovery_attempts VALIDATE CONSTRAINT pda_credits_nonnegative;
ALTER TABLE public.prospect_discovery_attempts VALIDATE CONSTRAINT pda_tenant_funding_uncharged;
ALTER TABLE public.prospect_discovery_attempts VALIDATE CONSTRAINT pda_screening_nonnegative;
ALTER TABLE public.prospect_discovery_attempts VALIDATE CONSTRAINT pda_screening_within_observed;

DO $verify$
DECLARE
  p text;
BEGIN
  FOREACH p IN ARRAY ARRAY['pea_funding_valid', 'pea_cost_units_nonnegative', 'pea_credits_nonnegative',
      'pea_tenant_funding_uncharged'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = p
                   AND conrelid = 'public.prospect_enrichment_attempts'::regclass AND convalidated) THEN
      RAISE EXCEPTION 'usage validate postcondition: % is missing or not validated', p; END IF;
  END LOOP;
  FOREACH p IN ARRAY ARRAY['pda_funding_valid', 'pda_credits_nonnegative', 'pda_tenant_funding_uncharged',
      'pda_screening_nonnegative', 'pda_screening_within_observed'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = p
                   AND conrelid = 'public.prospect_discovery_attempts'::regclass AND convalidated) THEN
      RAISE EXCEPTION 'usage validate postcondition: % is missing or not validated', p; END IF;
  END LOOP;
END
$verify$;

COMMIT;

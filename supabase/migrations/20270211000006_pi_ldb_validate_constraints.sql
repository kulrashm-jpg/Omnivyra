-- 20270211000006 pi_ldb_validate_constraints (version requested from virality-83, 2026-11-11)
--
-- Second step of the PI-LDB block. 20270211000001 (source_assertions),
-- 20270211000003 and 20270211000005 (lead_intelligence) add their CHECKs and
-- FKs NOT VALID, because each of those files also does ADD COLUMN, whose
-- ACCESS EXCLUSIVE lock is held to COMMIT, and both tables are live and
-- growing. NOT VALID enforces on every new or updated row at once and scans
-- nothing. This file validates them in its OWN transaction: VALIDATE
-- CONSTRAINT takes SHARE UPDATE EXCLUSIVE, so reads and writes continue while
-- existing rows are scanned.
--
-- Every existing row passes: each constraint concerns a column added by those
-- files, which is NULL on every pre-existing row, and each CHECK is
-- NULL-tolerant; the FKs are MATCH SIMPLE and skip NULL references.
--
-- MUST be applied after 20270211000005, as its own migration. Idempotent:
-- validating a valid constraint is a no-op. No new object, so no grant moves.
-- Rollback: nothing to undo (the constraints are dropped by their own files'
-- rollbacks).

BEGIN;

ALTER TABLE public.source_assertions VALIDATE CONSTRAINT source_assertions_platform_profile_scope;
ALTER TABLE public.source_assertions VALIDATE CONSTRAINT source_assertions_one_mapping_profile;
ALTER TABLE public.source_assertions VALIDATE CONSTRAINT source_assertions_source_field_not_blank;
ALTER TABLE public.source_assertions VALIDATE CONSTRAINT source_assertions_mapping_method_valid;
ALTER TABLE public.source_assertions VALIDATE CONSTRAINT source_assertions_validation_state_valid;
ALTER TABLE public.source_assertions VALIDATE CONSTRAINT source_assertions_approval_coherent;
ALTER TABLE public.source_assertions VALIDATE CONSTRAINT source_assertions_invalid_not_applied;
ALTER TABLE public.source_assertions VALIDATE CONSTRAINT source_assertions_mapping_profile_tenant_fk;
ALTER TABLE public.source_assertions VALIDATE CONSTRAINT source_assertions_platform_mapping_profile_fk;

ALTER TABLE public.lead_intelligence VALIDATE CONSTRAINT lead_intelligence_display_is_object;
ALTER TABLE public.lead_intelligence VALIDATE CONSTRAINT lead_intelligence_origin_category_valid;
ALTER TABLE public.lead_intelligence VALIDATE CONSTRAINT lead_intelligence_origin_observed_needs_category;

DO $verify$
DECLARE
  p text;
BEGIN
  FOREACH p IN ARRAY ARRAY['source_assertions_platform_profile_scope', 'source_assertions_one_mapping_profile',
      'source_assertions_source_field_not_blank', 'source_assertions_mapping_method_valid',
      'source_assertions_validation_state_valid', 'source_assertions_approval_coherent',
      'source_assertions_invalid_not_applied', 'source_assertions_mapping_profile_tenant_fk',
      'source_assertions_platform_mapping_profile_fk'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = p
                   AND conrelid = 'public.source_assertions'::regclass AND convalidated) THEN
      RAISE EXCEPTION 'PI-LDB validate postcondition: % is missing or not validated', p; END IF;
  END LOOP;
  FOREACH p IN ARRAY ARRAY['lead_intelligence_display_is_object', 'lead_intelligence_origin_category_valid',
      'lead_intelligence_origin_observed_needs_category'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = p
                   AND conrelid = 'public.lead_intelligence'::regclass AND convalidated) THEN
      RAISE EXCEPTION 'PI-LDB validate postcondition: % is missing or not validated', p; END IF;
  END LOOP;
END
$verify$;

COMMIT;

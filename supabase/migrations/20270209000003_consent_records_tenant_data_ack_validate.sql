-- 20270209000003 consent_records_tenant_data_ack_validate
-- (reserved by virality-83, 21f3a3e7a, 2026-11-11)
--
-- Second step of 20270209000002, which re-added consent_records_capability_check
-- NOT VALID (no row scan under ACCESS EXCLUSIVE). Production's consent_records
-- has never been analysed (C7: reltuples = -1), so its size is unknown and the
-- scan runs here, in its OWN transaction: VALIDATE CONSTRAINT takes SHARE
-- UPDATE EXCLUSIVE, so reads and writes continue. Every existing row passes:
-- the new CHECK is a strict superset of the validated one it replaced.
--
-- MUST be applied after 20270209000002, as its own migration. Idempotent:
-- validating a valid constraint is a no-op. No new object; no grant moves.
-- Rollback: nothing to undo (the constraint belongs to 20270209000002).

BEGIN;

ALTER TABLE public.consent_records VALIDATE CONSTRAINT consent_records_capability_check;

DO $verify$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.consent_records'::regclass
                    AND conname = 'consent_records_capability_check'
                    AND convalidated
                    AND pg_get_constraintdef(oid) LIKE '%tenant_data_controller_ack%') THEN
    RAISE EXCEPTION 'consent ack validate postcondition: consent_records_capability_check is missing, not validated, or does not admit tenant_data_controller_ack';
  END IF;
END
$verify$;

COMMIT;

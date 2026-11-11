-- 20270209000002 consent_records_tenant_data_ack
-- (reserved by virality-83, 54c064763, 2026-11-11)
--
-- Owner requirement (2026-11-11): a tenant DATA-CONTROLLER ACKNOWLEDGEMENT,
-- recorded in the EXISTING consent ledger (`consent_records`, append-only by
-- trigger: only revoked_at/revoked_by may change after insert, and DELETE is
-- blocked), not a parallel table. One row per acceptance:
--   capability 'tenant_data_controller_ack', platform 'pi_data',
--   consent_version = wording version, scope_snapshot = categories,
--   metadata = { text_sha256, wording_status, previous_version?, grace_* }.
-- Writer: backend/services/compliance/tenantDataAck.ts (COMPANY_ADMIN of the
-- tenant only; the shown version + text hash are verified server-side).
--
-- WHAT THIS DOES: widens consent_records_capability_check by exactly one value,
-- 'tenant_data_controller_ack', keeping the constraint's name.
--
-- LOCKING: replacing a CHECK takes ACCESS EXCLUSIVE. The new CHECK is added NOT
-- VALID, so this transaction scans no rows; it is a strict SUPERSET of the
-- validated one it replaces, so every existing row already satisfies it. The
-- VALIDATE (SHARE UPDATE EXCLUSIVE) runs separately.
--
-- PRECONDITION: refuses to replace a CHECK whose current value set differs
-- from the one recorded below (drift => stop, not overwrite). The recorded set
-- is the repository's (20260514_phase0_capability_consent_foundation.sql);
-- PRODUCTION's definition is being confirmed by virality-83's C7 catalogue read
-- before any apply.
--
-- APPLIED STATUS: this version has never been applied anywhere.

BEGIN;

DO $pre$
DECLARE
  v text[];
BEGIN
  IF to_regclass('public.consent_records') IS NULL THEN
    RAISE EXCEPTION 'consent ack precondition: public.consent_records does not exist';
  END IF;
  SELECT array_agg(m[1] ORDER BY m[1]) INTO v
    FROM pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') AS m
   WHERE c.conrelid = 'public.consent_records'::regclass
     AND c.conname = 'consent_records_capability_check';
  IF v IS DISTINCT FROM ARRAY['ingest_comments','ingest_communities','ingest_dms','ingest_mentions','listen','monitor_competitors','publish']::text[]
     AND v IS DISTINCT FROM ARRAY['ingest_comments','ingest_communities','ingest_dms','ingest_mentions','listen','monitor_competitors','publish','tenant_data_controller_ack']::text[] THEN
    RAISE EXCEPTION 'consent ack precondition: consent_records_capability_check is %, expected the 7 capability values of 20260514 (drift: stop and reconcile)', v;
  END IF;
END
$pre$;

ALTER TABLE public.consent_records DROP CONSTRAINT IF EXISTS consent_records_capability_check;
ALTER TABLE public.consent_records ADD CONSTRAINT consent_records_capability_check
  CHECK (capability IN (
    'publish', 'listen', 'monitor_competitors',
    'ingest_dms', 'ingest_comments', 'ingest_mentions', 'ingest_communities',
    'tenant_data_controller_ack'
  )) NOT VALID;

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.consent_records'::regclass
                    AND conname = 'consent_records_capability_check'
                    AND pg_get_constraintdef(oid) LIKE '%tenant_data_controller_ack%') THEN
    RAISE EXCEPTION 'consent ack postcondition: consent_records_capability_check does not admit tenant_data_controller_ack';
  END IF;
  -- The ledger's append-only guarantees must still stand (they are what make
  -- "one row per acceptance, no update path" true).
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'trg_consent_records_append_only_update')
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'trg_consent_records_block_delete') THEN
    RAISE EXCEPTION 'consent ack postcondition: the consent_records append-only/no-delete trigger functions are missing';
  END IF;
END
$post$;

COMMIT;

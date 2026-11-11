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
-- VALIDATE (SHARE UPDATE EXCLUSIVE) runs separately in 20270209000003
-- (production reltuples = -1 per C7: size unknown, so no in-file validate).
--
-- PRECONDITION: refuses to replace a CHECK whose current value set differs
-- from the one recorded below (drift => stop, not overwrite). The recorded set
-- is the repository's (20260514_phase0_capability_consent_foundation.sql);
-- PRODUCTION's definition was CONFIRMED by virality-83's C7 (owner-approved,
-- read-only, 2026-11-11): the same 7 values, validated; source_check
-- ui/api/system; both triggers present and enabled.
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
  -- PREMISE (GOV-SECURITY + PI review; the reference shape of
  -- g11_optout_review.test.ts PREMISE): "one row per acceptance, no update
  -- path" is true only because these TRIGGERS are ON public.consent_records,
  -- ENABLED ('O'), BEFORE + ROW + the right event, bound to the intended
  -- function, and that function STILL RAISES. Each is asserted; an object whose
  -- existence merely correlates with the behaviour is not. The body check is a
  -- SUBSTRING on the line that carries the premise (not md5): it survives benign
  -- edits and fails only when a CREATE OR REPLACE drops the refusal.
  -- tgtype bits: ROW = 1, BEFORE = 2, DELETE = 8, UPDATE = 16.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
                  WHERE t.tgrelid = 'public.consent_records'::regclass
                    AND t.tgname = 'consent_records_append_only' AND NOT t.tgisinternal
                    AND t.tgenabled = 'O'
                    AND (t.tgtype & 1) <> 0 AND (t.tgtype & 2) <> 0 AND (t.tgtype & 16) <> 0
                    AND p.oid = 'public.trg_consent_records_append_only_update()'::regprocedure) THEN
    RAISE EXCEPTION 'consent ack postcondition: trigger consent_records_append_only is missing, not enabled (O), not BEFORE ROW UPDATE, or not bound to public.trg_consent_records_append_only_update()';
  END IF;
  IF pg_get_functiondef('public.trg_consent_records_append_only_update()'::regprocedure)
       NOT LIKE '%consent_records is append-only; only revoked_at / revoked_by may be set after insert%' THEN
    RAISE EXCEPTION 'consent ack postcondition: public.trg_consent_records_append_only_update() no longer raises the append-only refusal';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
                  WHERE t.tgrelid = 'public.consent_records'::regclass
                    AND t.tgname = 'consent_records_no_delete' AND NOT t.tgisinternal
                    AND t.tgenabled = 'O'
                    AND (t.tgtype & 1) <> 0 AND (t.tgtype & 2) <> 0 AND (t.tgtype & 8) <> 0
                    AND p.oid = 'public.trg_consent_records_block_delete()'::regprocedure) THEN
    RAISE EXCEPTION 'consent ack postcondition: trigger consent_records_no_delete is missing, not enabled (O), not BEFORE ROW DELETE, or not bound to public.trg_consent_records_block_delete()';
  END IF;
  IF pg_get_functiondef('public.trg_consent_records_block_delete()'::regprocedure)
       NOT LIKE '%consent_records is append-only; deletes blocked%' THEN
    RAISE EXCEPTION 'consent ack postcondition: public.trg_consent_records_block_delete() no longer raises the deletes-blocked refusal';
  END IF;
END
$post$;

COMMIT;

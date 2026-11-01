-- ROLLBACK for 20270115000000_person_erasure_completion_verification.sql
--
-- ─── ORDER ─────────────────────────────────────────────────────────────────
-- Reverse version order, one transaction per file:
--   20270115000000 (this file) → (20270113000000 A6-10 bridge, if applied) →
--   20270112000005 → 20270112000004 → 20270112000003 → 20270112000002 →
--   20270112000001 → 20270112000000.
--
-- ─── WHAT IT REMOVES (everything 20270115000000 created; nothing existed before) ─
--   functions  pi_person_erasure_verify(uuid, uuid)
--              pi_person_erasure_capture_inventory(uuid, uuid, uuid)
--   tables     person_erasure_verifications, person_erasure_inventories (with
--              their index, policy, constraints and grants)
-- The erasure ledger (20270112000003) and every erasure already performed are
-- untouched.
--
-- ─── IT REFUSES WHEN EITHER TABLE HOLDS ANY ROW ────────────────────────────
-- person_erasure_verifications is the record of what each completed erasure
-- left behind (outcome, checks and counts; no personal data).
-- person_erasure_inventories is held for a residual request until a clean
-- re-verification (it holds the erased person's uuid and the ids of rows that
-- kept personal data); without it that request can never be re-verified.
-- Dropping either non-empty table destroys that evidence, and a rollback never
-- deletes data. Once erasure verification data exists the only way off this
-- migration is FORWARD-FIX (a new migration), or an export under the owner's
-- retention decision first — not deleting rows to make this file pass.
-- MEASURE FIRST:
--
--   SELECT 'verifications' AS t, count(*) FROM public.person_erasure_verifications
--   UNION ALL SELECT 'inventories', count(*) FROM public.person_erasure_inventories;
--
-- ─── APPLICATION ───────────────────────────────────────────────────────────
-- Roll the application back FIRST (or make the erasure API unreachable) before
-- running this file. The erasure API (pages/api/prospect-identity/erasure-
-- requests/*) checks for this migration's functions before it starts or resumes
-- an erasure (erasureSchemaReady) and answers 503 ERASURE_SCHEMA_NOT_READY
-- without calling erasePerson once they are gone. An application build WITHOUT
-- that gate is NOT harmless here: erasePerson runs steps 3-5 (governance
-- re-anchor, revocation of the originals, evidence-link clearing) BEFORE its
-- beforeFinalize hook captures the inventory, so each attempt would commit
-- those steps, then fail at the capture ("function missing" ->
-- verification_unavailable) and leave a PARTIALLY_COMPLETED request: governance
-- revoked and evidence links cleared, the person NOT deleted (the irreversible
-- steps 6-7 never run). Status reads report verification as unavailable and
-- never COMPLETED. Deploy order is the mirror image: 20270112000000..05 and
-- 20270115000000 are applied BEFORE the erasure API is reachable.

BEGIN;

DO $rollback_guard$
DECLARE
  v_verifications bigint := 0;
  v_inventories   bigint := 0;
BEGIN
  -- Serialise against a concurrent capture/verify, then count.
  IF to_regclass('public.person_erasure_verifications') IS NOT NULL THEN
    LOCK TABLE public.person_erasure_verifications IN ACCESS EXCLUSIVE MODE;
    SELECT count(*) INTO v_verifications FROM public.person_erasure_verifications;
  END IF;
  IF to_regclass('public.person_erasure_inventories') IS NOT NULL THEN
    LOCK TABLE public.person_erasure_inventories IN ACCESS EXCLUSIVE MODE;
    SELECT count(*) INTO v_inventories FROM public.person_erasure_inventories;
  END IF;
  IF v_verifications > 0 OR v_inventories > 0 THEN
    RAISE EXCEPTION
      '20270115000000 rollback refused: person_erasure_verifications holds % row(s) and '
      'person_erasure_inventories holds % row(s) of erasure verification evidence. Dropping them '
      'would destroy it, and a rollback never deletes data. Stay on the migration and forward-fix, '
      'or export under the owner''s retention decision first (see this file''s header).',
      v_verifications, v_inventories;
  END IF;
END
$rollback_guard$;

DROP FUNCTION IF EXISTS public.pi_person_erasure_verify(uuid, uuid);
DROP FUNCTION IF EXISTS public.pi_person_erasure_capture_inventory(uuid, uuid, uuid);
DROP TABLE IF EXISTS public.person_erasure_verifications;
DROP TABLE IF EXISTS public.person_erasure_inventories;

COMMIT;

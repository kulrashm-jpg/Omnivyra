-- ROLLBACK for 20270112000003_person_erasure_requests.sql
--
-- ─── ORDER ─────────────────────────────────────────────────────────────────
-- Reverse version order, one transaction per file:
--   (20270113000000 A6-10 bridge, if applied) → 20270112000005 →
--   20270112000004 → 20270112000003 (this file) → 20270112000002 →
--   20270112000001 → 20270112000000.
-- REFUSES unless the 20270112000004 and 20270112000005 rollbacks have run
-- (both hooks must be back to the retain default this migration created).
--
-- ─── WHAT IT REMOVES (everything 20270112000003 created; nothing existed before) ─
--   functions  pi_person_erasure_inconsistencies(uuid)
--              pi_person_erasure_finalize(uuid, uuid, uuid)
--              pi_person_erasure_mark(uuid, uuid, uuid, text, integer, text)
--              pi_person_erasure_open(uuid, uuid, text, text, integer)
--              pi_person_erasure_decision_ref_policy(uuid, uuid)
--              pi_person_erasure_legacy_lead_policy(uuid, uuid)
--   table      person_erasure_requests (with its two indexes, per_service_role_read
--              policy, constraints, grants and comment)
-- Functions first (they name the table's row type), then the table. No CASCADE:
-- an unexpected dependent makes the DROP fail and the whole file roll back.
--
-- ─── IT REFUSES WHEN THE LEDGER HOLDS ANY ROW ──────────────────────────────
-- person_erasure_requests is the evidence that erasures were requested and
-- completed (request id, requester label, step timestamps, provenance event id).
-- Dropping a non-empty ledger destroys that evidence, and a rollback never
-- deletes data. If rows exist the answer is to STAY on this migration, or to
-- export the ledger under the owner's retention decision first — not to
-- delete rows to make this file pass. MEASURE FIRST:
--
--   SELECT status, count(*) FROM public.person_erasure_requests GROUP BY status;
--
-- ─── APPLICATION ───────────────────────────────────────────────────────────
-- backend personErasure.ts calls pi_person_erasure_open/_mark/_finalize and fails
-- closed ('erasure_ledger_unavailable') without them: revert it in the same
-- change, or erasure stops working.

BEGIN;

DO $rollback_guard$
DECLARE
  v_rows bigint;
BEGIN
  IF to_regclass('public.person_erasure_requests') IS NULL THEN
    RAISE EXCEPTION '20270112000003 rollback refused: public.person_erasure_requests does not exist '
      '(not applied, or already rolled back)';
  END IF;
  IF to_regprocedure('public.pi_person_erasure_legacy_lead_policy(uuid, uuid)') IS NULL
     OR position('''legacy_lead_fields'', ''retain''' IN
          (SELECT prosrc FROM pg_proc WHERE oid = 'public.pi_person_erasure_legacy_lead_policy(uuid, uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '20270112000003 rollback refused: pi_person_erasure_legacy_lead_policy is not the '
      '20270112000003 retain default - run rollbacks/erasure_legacy_lead_redaction_rollback.sql (20270112000004) first';
  END IF;
  IF to_regprocedure('public.pi_person_erasure_decision_ref_policy(uuid, uuid)') IS NULL
     OR position('''outreach_decision_person_ref'', ''retain''' IN
          (SELECT prosrc FROM pg_proc WHERE oid = 'public.pi_person_erasure_decision_ref_policy(uuid, uuid)'::regprocedure)) = 0
     OR position('pi_erasure_authorization_held' IN
          (SELECT prosrc FROM pg_proc WHERE oid = 'public.ws3_reject_mutation()'::regprocedure)) > 0 THEN
    RAISE EXCEPTION '20270112000003 rollback refused: 20270112000005 is still in force - run '
      'rollbacks/outreach_decisions_erasure_person_ref_rollback.sql (20270112000005) first';
  END IF;

  -- Serialise against a concurrent open/finalize, then count.
  LOCK TABLE public.person_erasure_requests IN ACCESS EXCLUSIVE MODE;
  SELECT count(*) INTO v_rows FROM public.person_erasure_requests;
  IF v_rows > 0 THEN
    RAISE EXCEPTION
      '20270112000003 rollback refused: person_erasure_requests holds % row(s) of erasure evidence. '
      'Dropping the ledger would destroy it, and a rollback never deletes data. Stay on the '
      'migration, or export the ledger under the owner''s retention decision first (see this file''s header).',
      v_rows;
  END IF;
END
$rollback_guard$;

DROP FUNCTION public.pi_person_erasure_inconsistencies(uuid);
DROP FUNCTION public.pi_person_erasure_finalize(uuid, uuid, uuid);
DROP FUNCTION public.pi_person_erasure_mark(uuid, uuid, uuid, text, integer, text);
DROP FUNCTION public.pi_person_erasure_open(uuid, uuid, text, text, integer);
DROP FUNCTION public.pi_person_erasure_decision_ref_policy(uuid, uuid);
DROP FUNCTION public.pi_person_erasure_legacy_lead_policy(uuid, uuid);

-- Policy, indexes, constraints (incl. per_person_tenant_fk / per_org_fk), grants
-- and the comment go with the table.
DROP TABLE public.person_erasure_requests;

DO $verify$
BEGIN
  IF to_regclass('public.person_erasure_requests') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname IN (
                   'pi_person_erasure_inconsistencies', 'pi_person_erasure_finalize',
                   'pi_person_erasure_mark', 'pi_person_erasure_open',
                   'pi_person_erasure_decision_ref_policy', 'pi_person_erasure_legacy_lead_policy')) THEN
    RAISE EXCEPTION '20270112000003 rollback postcondition: an erasure-ledger object survived';
  END IF;
END
$verify$;

COMMIT;

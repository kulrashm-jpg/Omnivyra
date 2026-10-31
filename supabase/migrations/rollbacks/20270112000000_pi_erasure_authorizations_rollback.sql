-- ROLLBACK for 20270112000000_pi_erasure_authorizations.sql
--
-- ─── ORDER ─────────────────────────────────────────────────────────────────
-- LAST of the erasure rollbacks. Reverse version order, one transaction per file:
--   (20270113000000 A6-10 bridge, if applied) → 20270112000005 →
--   20270112000004 → 20270112000003 → 20270112000002 → 20270112000001 →
--   20270112000000 (this file).
-- REFUSES while any function other than the three below still calls
-- pi_erasure_authorize / pi_erasure_release / pi_erasure_authorization_held.
-- PL/pgSQL calls are not tracked in pg_depend, so a plain DROP would succeed
-- and leave those callers failing at run time; the check makes it explicit.
-- Callers it catches: leads_person_erasure_guard / pi_erasure_detach_legacy_leads
-- (…01), prospect_score_evaluations_immutable / pi_erasure_redact_score_evaluations
-- (…02), pi_person_erasure_finalize (…03), ws3_reject_mutation /
-- pi_person_erasure_decision_ref_policy (…05), and the A6-10
-- outreach_bridge_handoffs_guard (20270113000000).
--
-- ─── WHAT IT REMOVES (all created by this migration; nothing existed before) ─
--   pi_erasure_authorization_held(text, uuid, uuid)
--   pi_erasure_release(text, uuid, uuid)
--   pi_erasure_authorize(text, uuid, uuid)
--   table pi_erasure_authorizations (constraints, RLS flag, revokes, comment)
--
-- ─── IT REFUSES WHEN THE TABLE HOLDS ANY ROW ───────────────────────────────
-- Every writer deletes its authorization before returning, and an aborted
-- transaction takes its row with it, so the table is empty at rest. A row here
-- means an authorization leaked (a defect) and names a tenant and a person;
-- it is evidence for that investigation, and a rollback never deletes data.
--   SELECT xact_id, scope, organization_id, created_at FROM public.pi_erasure_authorizations;

BEGIN;

DO $rollback_guard$
DECLARE
  v_dep  text;
  v_rows bigint;
BEGIN
  IF to_regclass('public.pi_erasure_authorizations') IS NULL THEN
    RAISE EXCEPTION '20270112000000 rollback refused: public.pi_erasure_authorizations does not exist '
      '(not applied, or already rolled back)';
  END IF;

  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text) INTO v_dep
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND p.proname NOT IN ('pi_erasure_authorize', 'pi_erasure_release', 'pi_erasure_authorization_held')
     AND (p.prosrc LIKE '%pi_erasure_authoriz%' OR p.prosrc LIKE '%pi_erasure_release%');
  IF v_dep IS NOT NULL THEN
    RAISE EXCEPTION '20270112000000 rollback refused: still called by % - roll back 20270113000000 '
      '(A6-10, if applied) and 20270112000005..01 first', v_dep;
  END IF;

  LOCK TABLE public.pi_erasure_authorizations IN ACCESS EXCLUSIVE MODE;
  SELECT count(*) INTO v_rows FROM public.pi_erasure_authorizations;
  IF v_rows > 0 THEN
    RAISE EXCEPTION
      '20270112000000 rollback refused: pi_erasure_authorizations holds % leaked authorization row(s). '
      'They are evidence of a defect and are not deleted by a rollback (see this file''s header).',
      v_rows;
  END IF;
END
$rollback_guard$;

DROP FUNCTION public.pi_erasure_authorization_held(text, uuid, uuid);
DROP FUNCTION public.pi_erasure_release(text, uuid, uuid);
DROP FUNCTION public.pi_erasure_authorize(text, uuid, uuid);
DROP TABLE public.pi_erasure_authorizations;

DO $verify$
BEGIN
  IF to_regclass('public.pi_erasure_authorizations') IS NOT NULL
     OR to_regprocedure('public.pi_erasure_authorization_held(text, uuid, uuid)') IS NOT NULL
     OR to_regprocedure('public.pi_erasure_release(text, uuid, uuid)') IS NOT NULL
     OR to_regprocedure('public.pi_erasure_authorize(text, uuid, uuid)') IS NOT NULL THEN
    RAISE EXCEPTION '20270112000000 rollback postcondition: an erasure-authorization object survived';
  END IF;
END
$verify$;

COMMIT;

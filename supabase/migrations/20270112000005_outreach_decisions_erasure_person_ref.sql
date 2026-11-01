-- OWNER-SELECTABLE — outreach_decisions.person_id after erasure.
-- This commit is DROPPABLE: without it, pi_person_erasure_decision_ref_policy
-- stays the 20270112000003 default (retain) and nothing else changes.
-- Requires an owner decision (D-2 v3 item "outreach_decisions residual"): it
-- REVERSES a deliberate A3 design choice (20261011000000 section 4: "a decision
-- record must keep naming the person it was about even after that person is
-- erased from the spine — that is what makes it an audit record").
--
-- WHY IT IS AN ISSUE. outreach_decisions.person_id has NO foreign key (a SET
-- NULL action would hit the append-only trigger), so the erased person's uuid
-- survives in every governance verdict about them. It links those verdicts to
-- each other, to outreach_tasks (task_id) and to anything else that retained the
-- uuid (input_digest of score evaluations hashes it, logs, exports). The
-- erasure module's own rule says such a residual key is not an erasure.
--
-- THE CHANGE. ws3_reject_mutation (shared by the append-only WS3 tables) gains
-- ONE admission, for outreach_decisions only: an UPDATE whose only change is
-- person_id non-NULL -> NULL, while the erasure flow holds the
-- 'outreach_decisions' authorization for that tenant and person in the current
-- transaction (20270112000000). Everything else stays refused with the same
-- message and SQLSTATE; DELETE stays refused; the other tables are unaffected.
-- The function keeps its name, owner and SECURITY INVOKER, and the trigger set
-- is unchanged (20261011000000's "7 x ws3_reject_mutation" still holds). The
-- authorization check is wrapped: a client role cannot execute it, and gets the
-- original append-only refusal.
-- identity_anchor / identity_degraded are left as written: they say HOW the
-- decision was anchored, not WHO, and outreach_decisions_identity_coherent
-- constrains them, not person_id.
--
-- J1 ER-1 (edited in place on privacy/erasure-remediation-fixes; this migration
-- is unapplied everywhere). CREATE OR REPLACE resets proconfig, so the
-- replacement carries the SAME pin SEC-B (20270111000003, origin/main; earlier 20270110000003/04) sets
-- with ALTER FUNCTION ... SET search_path = pg_catalog, public. Every non-catalog
-- reference in the body is schema-qualified (public.pi_erasure_authorization_held);
-- to_jsonb / ~* resolve in pg_catalog. $verify$ asserts the pin. Applied after
-- SEC-B (the version order) or before it (ledger desync), the final proconfig
-- is search_path=pg_catalog, public either way, which is what SEC-B's
-- preflight/postcondition expect for this function.

BEGIN;

DO $preflight$
BEGIN
  IF to_regprocedure('public.pi_person_erasure_decision_ref_policy(uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION 'decision-ref preflight: apply 20270112000003 (erasure ledger) first';
  END IF;
  IF to_regprocedure('public.ws3_reject_mutation()') IS NULL THEN
    RAISE EXCEPTION 'decision-ref preflight: ws3_reject_mutation() is missing';
  END IF;
END
$preflight$;

CREATE OR REPLACE FUNCTION public.ws3_reject_mutation() RETURNS trigger
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_ok boolean := false;
BEGIN
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'outreach_decisions' AND TG_TABLE_SCHEMA = 'public' THEN
    IF OLD.person_id IS NOT NULL AND NEW.person_id IS NULL
       AND OLD.company_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       AND (to_jsonb(NEW) - 'person_id') = (to_jsonb(OLD) - 'person_id') THEN
      BEGIN
        v_ok := public.pi_erasure_authorization_held('outreach_decisions', OLD.company_id::text::uuid, OLD.person_id);
      EXCEPTION WHEN insufficient_privilege THEN
        v_ok := false;
      END;
      IF v_ok THEN
        RETURN NEW;
      END IF;
    END IF;
  END IF;
  RAISE EXCEPTION 'ws3_append_only: % is append-only; % is not permitted',
    TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.pi_person_erasure_decision_ref_policy(p_organization_id uuid, p_person_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_n integer;
BEGIN
  PERFORM public.pi_erasure_authorize('outreach_decisions', p_organization_id, p_person_id);
  UPDATE public.outreach_decisions d
     SET person_id = NULL
   WHERE d.company_id::text = p_organization_id::text   -- uuid today; text in the 20260910000000 DDL
     AND d.person_id = p_person_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM public.pi_erasure_release('outreach_decisions', p_organization_id, p_person_id);
  RETURN jsonb_build_object('outreach_decision_person_ref', 'null', 'outreach_decisions_unlinked', v_n);
END
$fn$;

-- Static form of the client-role revokes below, for check-migration-quality
-- (it reads top-level statements only). No privilege change: the DO block
-- already revokes the same roles; anon/authenticated exist on every target.
REVOKE ALL ON FUNCTION public.pi_person_erasure_decision_ref_policy(uuid, uuid) FROM PUBLIC, anon, authenticated;

DO $revoke_fn$
DECLARE r text;
BEGIN
  REVOKE ALL ON FUNCTION public.pi_person_erasure_decision_ref_policy(uuid, uuid) FROM PUBLIC;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.pi_person_erasure_decision_ref_policy(uuid, uuid) FROM %I', r);
    END IF;
  END LOOP;
END
$revoke_fn$;

DO $verify$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
   WHERE p.proname = 'ws3_reject_mutation' AND NOT t.tgisinternal;
  IF n < 5 THEN
    RAISE EXCEPTION 'decision-ref postcondition: ws3_reject_mutation triggers missing (found %)', n;
  END IF;
  -- J1 ER-1: the SEC-B search_path pin survives the CREATE OR REPLACE.
  IF (SELECT proconfig FROM pg_proc WHERE oid = 'public.ws3_reject_mutation()'::regprocedure)
       IS DISTINCT FROM ARRAY['search_path=pg_catalog, public'] THEN
    RAISE EXCEPTION 'decision-ref postcondition: ws3_reject_mutation search_path is not pinned to pg_catalog, public';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.ws3_reject_mutation()'::regprocedure) THEN
    RAISE EXCEPTION 'decision-ref postcondition: ws3_reject_mutation must stay SECURITY INVOKER';
  END IF;
END
$verify$;

COMMIT;

-- Rollback (returns to retain for FUTURE erasures; nulled references stay NULL):
--   restore the 20260910000000 body of public.ws3_reject_mutation() (unconditional RAISE), and
--   the 20270112000003 body of public.pi_person_erasure_decision_ref_policy(uuid, uuid).

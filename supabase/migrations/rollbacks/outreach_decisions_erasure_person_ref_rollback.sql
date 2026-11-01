-- ROLLBACK for 20270112000005_outreach_decisions_erasure_person_ref.sql
--
-- ─── ORDER ─────────────────────────────────────────────────────────────────
-- The erasure rollbacks run in REVERSE version order, each in its own
-- transaction, and each refuses when run out of order:
--   (20270113000000 A6-10 bridge, if applied) → 20270112000005 (this file) →
--   20270112000004 → 20270112000003 → 20270112000002 → 20270112000001 →
--   20270112000000.
-- 20270112000004 and this file are independent of each other (both only
-- replace a 20270112000003 hook), but 20270112000003's rollback requires both.
--
-- ─── WHAT IT RESTORES ──────────────────────────────────────────────────────
--   * public.ws3_reject_mutation() — the 20260910000000 body (unconditional
--     RAISE, SECURITY INVOKER, plpgsql). Its proconfig is restored to what it
--     was before 20270112000005 replaced it:
--       - no SET clause (the 20260910000000 state), or
--       - search_path = pg_catalog, public when SEC-B
--         (20270111000003_function_execute_classwide_hardening) had already
--         pinned it. CREATE OR REPLACE resets proconfig, so the pin cannot be
--         read back from this function itself; the witness is its sibling
--         public.ws3_protect_task_provenance() (same file, same SEC-B class-T
--         treatment, untouched by every erasure migration).
--     Owner and ACL are unchanged by the forward migration (CREATE OR REPLACE
--     keeps them) and are not touched here. The trigger set is unchanged.
--   * public.pi_person_erasure_decision_ref_policy(uuid, uuid) — the
--     20270112000003 default (R = retain). Its ACL is the same before and after
--     (both migrations REVOKE ALL from PUBLIC/anon/authenticated/service_role).
--
-- ─── WHAT IT DOES NOT DO ───────────────────────────────────────────────────
-- outreach_decisions rows whose person_id was nulled by an erasure while the
-- forward migration was in force STAY NULL. That is the erasure; it is
-- irreversible by design and this rollback never writes a row. From now on
-- FUTURE erasures retain the decision's person reference again.
--
-- Count of decisions nulled so far (for the record; nothing here changes them):
--   SELECT count(*) FROM public.outreach_decisions WHERE person_id IS NULL;

BEGIN;

DO $preflight$
BEGIN
  IF to_regprocedure('public.ws3_reject_mutation()') IS NULL THEN
    RAISE EXCEPTION '20270112000005 rollback refused: public.ws3_reject_mutation() is missing';
  END IF;
  IF to_regprocedure('public.pi_person_erasure_decision_ref_policy(uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION '20270112000005 rollback refused: pi_person_erasure_decision_ref_policy is missing '
      '(20270112000003 is not applied or was already rolled back - rolling this back now would '
      're-create a 20270112000003 object; out of order)';
  END IF;
  IF to_regprocedure('public.ws3_protect_task_provenance()') IS NULL THEN
    RAISE EXCEPTION '20270112000005 rollback refused: the SEC-B witness public.ws3_protect_task_provenance() is missing';
  END IF;
END
$preflight$;

-- 20260910000000_ws3_lead_outreach_execution.sql, verbatim body.
CREATE OR REPLACE FUNCTION public.ws3_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ws3_append_only: % is append-only; % is not permitted',
    TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

-- SEC-B pin, only if SEC-B is in force (see header).
DO $secb_pin$
BEGIN
  IF (SELECT proconfig FROM pg_proc WHERE oid = 'public.ws3_protect_task_provenance()'::regprocedure)
       IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog, public'] THEN
    ALTER FUNCTION public.ws3_reject_mutation() SET search_path = pg_catalog, public;
  END IF;
END
$secb_pin$;

-- 20270112000003_person_erasure_requests.sql, verbatim default hook.
CREATE OR REPLACE FUNCTION public.pi_person_erasure_decision_ref_policy(p_organization_id uuid, p_person_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
  -- R (retain): outreach_decisions.person_id keeps naming the erased person's
  -- uuid, as A3 (20261011000000 section 4) designed. Pending the owner decision.
  RETURN jsonb_build_object('outreach_decision_person_ref', 'retain');
END
$fn$;

DO $verify$
DECLARE
  v_src  text;
  v_cfg  text[];
  v_wit  text[];
  r      text;
BEGIN
  SELECT prosrc, proconfig INTO v_src, v_cfg FROM pg_proc WHERE oid = 'public.ws3_reject_mutation()'::regprocedure;
  SELECT proconfig INTO v_wit FROM pg_proc WHERE oid = 'public.ws3_protect_task_provenance()'::regprocedure;
  IF position('pi_erasure_authorization_held' IN v_src) > 0 THEN
    RAISE EXCEPTION '20270112000005 rollback postcondition: ws3_reject_mutation still admits the erasure update';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.ws3_reject_mutation()'::regprocedure) THEN
    RAISE EXCEPTION '20270112000005 rollback postcondition: ws3_reject_mutation must be SECURITY INVOKER';
  END IF;
  IF (v_wit IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog, public'] AND v_cfg IS DISTINCT FROM v_wit)
     OR (v_wit IS DISTINCT FROM ARRAY['search_path=pg_catalog, public'] AND v_cfg IS NOT NULL) THEN
    RAISE EXCEPTION '20270112000005 rollback postcondition: ws3_reject_mutation proconfig % does not match the pre-migration state', v_cfg;
  END IF;
  IF position('''outreach_decision_person_ref'', ''retain''' IN
       (SELECT prosrc FROM pg_proc WHERE oid = 'public.pi_person_erasure_decision_ref_policy(uuid, uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '20270112000005 rollback postcondition: decision_ref_policy is not the retain default';
  END IF;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r)
       AND has_function_privilege(r, 'public.pi_person_erasure_decision_ref_policy(uuid, uuid)', 'EXECUTE') THEN
      RAISE EXCEPTION '20270112000005 rollback postcondition: role % can execute decision_ref_policy', r;
    END IF;
  END LOOP;
END
$verify$;

COMMIT;

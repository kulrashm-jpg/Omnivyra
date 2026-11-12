-- Decision events: the trigger function writes decision_events.company_id (e9, 2026-11-12;
-- found by 05's MIG-2R work). Version 20270217000019 assigned by the registry owner (83, 78ba018a4).
--
-- PROD STATE (83, C20/C21 owner-approved catalog reads, 2026-11-12): the live body is 20260411's
-- (md5(prosrc) 64faad0ef8a81658661c1dbef94e5ddf, a CRLF body); proconfig search_path=pg_catalog,
-- public (20270111000003 applied); proacl postgres + service_role only; SECURITY INVOKER; the
-- trigger is enabled. CREATE OR REPLACE keeps the grants but drops proconfig unless it is restated,
-- so the SET clause below restates it exactly.
--
-- THE DEFECT (prod). 20260430_decision_events_company_id_fix was applied only IN PART:
--   * its DDL half is live: decision_events.company_id is NOT NULL (no default), with
--     decision_events_company_fk and idx_decision_events_company_created;
--   * its function half is NOT: public.omnivyra_log_decision_event() still has the 20260411
--     body, which inserts into decision_events WITHOUT company_id.
-- trg_decision_objects_log_events is AFTER INSERT OR UPDATE ... FOR EACH ROW, so every
-- decision_objects insert and update raises 23502 (not-null violation) and aborts.
--
-- WHAT THIS DOES. ONLY the function half of 20260430, re-authored:
--   * the same body as 20260430 (company_id from NEW on both inserts), with the table
--     schema-qualified;
--   * SET search_path = pg_catalog, public IN the CREATE. That is the proconfig
--     20270111000003 expects for this function, and CREATE OR REPLACE would otherwise
--     DROP an existing proconfig;
--   * REVOKE ALL FROM PUBLIC, anon, authenticated, as 20270111000003 does for class T
--     (trigger functions). Firing a trigger needs no EXECUTE privilege, so no write path
--     changes.
-- WHAT THIS DOES NOT DO. No DDL: the 20260430 table half is NOT re-run, and
-- decision_events.company_id stays NOT NULL. No trigger is created, dropped or changed. No
-- data is touched.
--
-- Preflight refuses to run unless the DDL half is in place and the trigger exists as expected,
-- so this can never replace the function under a schema it does not fit.
-- Rollback: supabase/migrations/rollbacks/decision_event_trigger_company_id_rollback.sql.
--   It restores the 20260411 body. That body is the DEFECT on a NOT NULL schema: roll back
--   only together with a schema rollback.
-- Behavioural proof (CI): backend/tests/realschema/decision_event_trigger_company_id.test.ts.

BEGIN;

DO $preflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute a
     WHERE a.attrelid = 'public.decision_events'::regclass
       AND a.attname = 'company_id' AND NOT a.attisdropped AND a.attnotnull
  ) THEN
    RAISE EXCEPTION 'DEC-EVT preflight: public.decision_events.company_id must exist and be NOT NULL (the 20260430 DDL half)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute a
     WHERE a.attrelid = 'public.decision_objects'::regclass
       AND a.attname = 'company_id' AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'DEC-EVT preflight: public.decision_objects.company_id not found';
  END IF;

  IF to_regprocedure('public.omnivyra_log_decision_event()') IS NULL THEN
    RAISE EXCEPTION 'DEC-EVT preflight: public.omnivyra_log_decision_event() not found';
  END IF;

  -- Replace ONLY a body we know. Accepted md5(prosrc):
  --   64faad0ef8a81658661c1dbef94e5ddf  20260411 body, CRLF (prod today, per C20)
  --   8bad7afa08dc1226d6982f268ed92a28  20260411 body, LF (the committed baseline / CI replay)
  --   91053ed21f92b1fab46db0cdc09d7ecb  this migration's body (a re-run)
  -- Anything else was changed by someone this migration does not know about: refuse, do not overwrite.
  IF (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.omnivyra_log_decision_event()'::regprocedure)
     NOT IN ('64faad0ef8a81658661c1dbef94e5ddf', '8bad7afa08dc1226d6982f268ed92a28', '91053ed21f92b1fab46db0cdc09d7ecb') THEN
    RAISE EXCEPTION 'DEC-EVT preflight: public.omnivyra_log_decision_event() has an unexpected body (md5 %); refusing to replace it',
      (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.omnivyra_log_decision_event()'::regprocedure);
  END IF;

  -- service_role's EXECUTE as FOUND, recorded for $verify$ (transaction-local; this file is one
  -- transaction). Prod has an explicit grant; a baseline replay (CI) has none once 20270111000003 has
  -- revoked PUBLIC. CREATE OR REPLACE keeps grants, so the postcondition is "unchanged", not "present"
  -- (CI-86: asserting "present" refused every CI replay).
  PERFORM set_config('dec_evt.service_role_exec_before',
    CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')
         THEN has_function_privilege('service_role', 'public.omnivyra_log_decision_event()'::regprocedure, 'EXECUTE')::text
         ELSE 'no_role' END,
    true);

  -- The trigger this function serves: AFTER INSERT OR UPDATE, FOR EACH ROW, enabled.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid = 'public.decision_objects'::regclass
       AND t.tgname = 'trg_decision_objects_log_events'
       AND NOT t.tgisinternal
       AND t.tgfoid = 'public.omnivyra_log_decision_event()'::regprocedure
       AND t.tgenabled <> 'D'
  ) THEN
    RAISE EXCEPTION 'DEC-EVT preflight: trg_decision_objects_log_events on public.decision_objects is missing, disabled or calls another function';
  END IF;
END
$preflight$;

CREATE OR REPLACE FUNCTION public.omnivyra_log_decision_event()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  detected_event_type TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.decision_events (decision_id, company_id, event_type, previous_value, new_value, changed_by)
    VALUES (NEW.id, NEW.company_id, 'created', NULL, to_jsonb(NEW), COALESCE(NEW.last_changed_by, 'system'));
    RETURN NEW;
  END IF;

  detected_event_type := 'updated';
  IF OLD.status <> 'resolved' AND NEW.status = 'resolved' THEN
    detected_event_type := 'resolved';
  ELSIF OLD.status IN ('resolved', 'ignored') AND NEW.status = 'open' THEN
    detected_event_type := 'reopened';
  END IF;

  INSERT INTO public.decision_events (decision_id, company_id, event_type, previous_value, new_value, changed_by)
  VALUES (NEW.id, NEW.company_id, detected_event_type, to_jsonb(OLD), to_jsonb(NEW), COALESCE(NEW.last_changed_by, 'system'));

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.omnivyra_log_decision_event() FROM PUBLIC, anon, authenticated;

-- Where service_role's EXECUTE came only from PUBLIC (an environment where 20270111000003 has not
-- run), the REVOKE above would strip it as a side effect. Keep it exactly as found: grant it back
-- explicitly when the preflight recorded it as held. Prod (an explicit grant) and a baseline replay
-- (none, PUBLIC already revoked) are unchanged by this.
DO $keep_service_role$
BEGIN
  IF current_setting('dec_evt.service_role_exec_before', true) = 'true' THEN
    GRANT EXECUTE ON FUNCTION public.omnivyra_log_decision_event() TO service_role;
  END IF;
END
$keep_service_role$;

DO $verify$
DECLARE
  r      record;
  v_role text;
BEGIN
  SELECT p.oid, p.prosecdef, p.proconfig, p.proacl, p.prosrc, p.prorettype INTO r
    FROM pg_proc p
   WHERE p.oid = 'public.omnivyra_log_decision_event()'::regprocedure;

  IF r.prorettype <> 'trigger'::regtype THEN
    RAISE EXCEPTION 'DEC-EVT postcondition: must return trigger';
  END IF;
  IF r.prosecdef THEN
    RAISE EXCEPTION 'DEC-EVT postcondition: must be SECURITY INVOKER';
  END IF;
  -- Exactly the proconfig 20270111000003 expects for this function.
  IF r.proconfig IS DISTINCT FROM '{"search_path=pg_catalog, public"}'::text[] THEN
    RAISE EXCEPTION 'DEC-EVT postcondition: proconfig must be {search_path=pg_catalog, public}; found %', r.proconfig;
  END IF;
  -- The fix itself: BOTH inserts carry company_id from NEW.
  IF (length(r.prosrc) - length(replace(r.prosrc, 'NEW.company_id', ''))) / length('NEW.company_id') <> 2 THEN
    RAISE EXCEPTION 'DEC-EVT postcondition: both decision_events inserts must write NEW.company_id';
  END IF;
  -- proacl IS NULL means the DEFAULT ACL, which for a function is EXECUTE to PUBLIC: open.
  IF r.proacl IS NULL THEN
    RAISE EXCEPTION 'DEC-EVT postcondition: proacl is NULL (default ACL = EXECUTE to PUBLIC)';
  END IF;
  IF EXISTS (SELECT 1 FROM aclexplode(r.proacl) a WHERE a.grantee = 0) THEN
    RAISE EXCEPTION 'DEC-EVT postcondition: PUBLIC still holds a privilege';
  END IF;
  -- has_function_privilege folds in PUBLIC and role membership.
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role)
       AND has_function_privilege(v_role, r.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'DEC-EVT postcondition: % has EXECUTE', v_role;
    END IF;
  END LOOP;
  -- CREATE OR REPLACE keeps the existing grants: service_role's EXECUTE must be exactly as the
  -- preflight found it (prod: held; a baseline replay: not held), never lost and never gained.
  IF current_setting('dec_evt.service_role_exec_before', true) IS NULL
     OR current_setting('dec_evt.service_role_exec_before', true) = '' THEN
    RAISE EXCEPTION 'DEC-EVT postcondition: the preflight did not record service_role EXECUTE (not one transaction?)';
  END IF;
  IF current_setting('dec_evt.service_role_exec_before', true) <> 'no_role'
     AND has_function_privilege('service_role', r.oid, 'EXECUTE')::text
         IS DISTINCT FROM current_setting('dec_evt.service_role_exec_before', true) THEN
    RAISE EXCEPTION 'DEC-EVT postcondition: service_role EXECUTE changed (before %, after %)',
      current_setting('dec_evt.service_role_exec_before', true), has_function_privilege('service_role', r.oid, 'EXECUTE');
  END IF;
  -- The body is exactly this migration's (the md5 the preflight accepts for a re-run).
  IF md5(r.prosrc) <> '91053ed21f92b1fab46db0cdc09d7ecb' THEN
    RAISE EXCEPTION 'DEC-EVT postcondition: unexpected body md5 % (expected 91053ed21f92b1fab46db0cdc09d7ecb)', md5(r.prosrc);
  END IF;

  -- The trigger still points at this function (nothing here changes it; asserted, not assumed).
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid = 'public.decision_objects'::regclass
       AND t.tgname = 'trg_decision_objects_log_events'
       AND t.tgfoid = r.oid
  ) THEN
    RAISE EXCEPTION 'DEC-EVT postcondition: trg_decision_objects_log_events no longer calls the function';
  END IF;

  RAISE NOTICE 'DEC-EVT: public.omnivyra_log_decision_event() writes company_id; search_path pinned; no client EXECUTE - verified.';
END
$verify$;

COMMIT;

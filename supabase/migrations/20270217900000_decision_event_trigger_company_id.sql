-- Decision events: the trigger function writes decision_events.company_id (e9, 2026-11-12;
-- found by 05's MIG-2R work). VERSION IS A PLACEHOLDER until 83 assigns one.
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

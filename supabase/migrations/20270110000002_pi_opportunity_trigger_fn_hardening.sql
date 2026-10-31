-- PI / Opportunity workflow — trigger-function hardening (SEC A2).
--
-- Scope: exactly three trigger functions, nothing else.
--   * public.trg_opp_lifecycle_block_mutation()    (20260520_phase6_realtime_lifecycle_workflow)
--   * public.trg_opp_disposition_block_mutation()  (20270109000003_pi_opportunity_governance)
--   * public.trg_opp_disposition_snooze_guard()    (20270109000003_pi_opportunity_governance)
--
-- ─── WHAT PRODUCTION HAD (read-only evidence, 2026-10-30T20:12Z) ──────────
--   lifecycle:   SECURITY INVOKER, NO pinned search_path,
--                EXECUTE to PUBLIC, anon, authenticated, service_role, postgres
--                (created before the default-privilege tightening of
--                20261026000000, so it kept PG's EXECUTE-to-PUBLIC default and
--                Supabase's anon grant);
--   disposition: SECURITY INVOKER, search_path = pg_catalog, public,
--                EXECUTE to authenticated, service_role, postgres (Supabase
--                default privileges for functions in public).
--
-- ─── WHY THIS IS DEFENCE IN DEPTH, NOT A BREACH FIX ───────────────────────
-- Measured on PostgreSQL 17 against a replayed real schema:
--   1. A trigger function cannot be called directly: `SELECT
--      public.trg_opp_lifecycle_block_mutation()` as anon fails with 0A000
--      "trigger functions can only be called as triggers". PostgREST never
--      exposes them on /rpc either: its schema cache drops every function
--      whose return type is `trigger` (`WHERE t.oid <> 'trigger'::regtype`,
--      PostgREST v10.0.0 through main).
--   2. EXECUTE is NOT checked when a trigger FIRES. With EXECUTE revoked from
--      every role (even the owner), service_role's UPDATE/DELETE on
--      opportunity_lifecycle_states / opportunity_dispositions is still
--      refused by these triggers and the snooze guard still refuses a snooze
--      on an archived opportunity. EXECUTE is only checked at CREATE TRIGGER
--      time (for the creating role), which is why postgres and service_role
--      keep it here.
--   3. The lifecycle body references no relation and no function; its only
--      name lookups are the built-in text `=` operator and RAISE. pg_catalog
--      is searched implicitly first, so an object planted in `public` cannot
--      shadow it. Only a caller who puts its own schema BEFORE pg_catalog in
--      ITS OWN session can redirect `=`, and the function is SECURITY INVOKER,
--      so that runs with the caller's own privileges. Measured effect: the
--      trigger returns NULL and the row change is silently skipped instead of
--      raising "append-only" — the row is still never modified.
-- So the grants and the unpinned search_path are not exploitable today. They
-- are removed because they are surface with no purpose: no client should be
-- able to name these functions, and every trigger function should resolve
-- names the same way regardless of the caller's session.
--
-- ─── WHAT CHANGES ─────────────────────────────────────────────────────────
--   * REVOKE ALL ... FROM PUBLIC, anon, authenticated on all three (house
--     style: 20270109000001 does the same for pi_prospect_alias_guard).
--     postgres (owner) and service_role are not touched, so they keep the
--     EXECUTE production gives them — not needed to fire a trigger, but
--     CREATE TRIGGER checks it for the creating role, so a later migration
--     (run as postgres) can still re-create these triggers.
--   * trg_opp_lifecycle_block_mutation gets SET search_path = pg_catalog,
--     public — the same value its two siblings already pin. Body, owner,
--     SECURITY INVOKER, error text and SQLSTATE (P0001) are unchanged, so
--     backend/services/lifecycleGuardErrors.ts classifies refusals as before.
-- No table, trigger, policy or table grant is touched.
--
-- Re-runnable: REVOKE and ALTER FUNCTION ... SET are idempotent; $verify$
-- re-proves the end state on every replay.
-- Rollback: supabase/migrations/rollbacks/pi_opportunity_trigger_fn_hardening_rollback.sql

BEGIN;

DO $preflight$
DECLARE
  r record;
  v_n integer;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('trg_opp_lifecycle_block_mutation'),
      ('trg_opp_disposition_block_mutation'),
      ('trg_opp_disposition_snooze_guard')) AS t(fn)
  LOOP
    SELECT count(*) INTO v_n
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname = r.fn
       AND p.pronargs = 0
       AND p.prorettype = 'trigger'::regtype;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'OPP-TRGFN preflight: public.%() returning trigger expected exactly once, found %', r.fn, v_n;
    END IF;
    -- A SECURITY DEFINER variant would need a different review (it would run
    -- as its owner); refuse rather than silently harden something unexpected.
    IF EXISTS (SELECT 1 FROM pg_proc p
                WHERE p.pronamespace = 'public'::regnamespace
                  AND p.proname = r.fn AND p.pronargs = 0 AND p.prosecdef) THEN
      RAISE EXCEPTION 'OPP-TRGFN preflight: public.%() is SECURITY DEFINER; expected INVOKER', r.fn;
    END IF;
  END LOOP;
END
$preflight$;

REVOKE ALL ON FUNCTION public.trg_opp_lifecycle_block_mutation()   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_opp_disposition_block_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_opp_disposition_snooze_guard()   FROM PUBLIC, anon, authenticated;

ALTER FUNCTION public.trg_opp_lifecycle_block_mutation() SET search_path = pg_catalog, public;

DO $verify$
DECLARE
  r     record;
  v_cfg text[];
  v_n   integer;
  v_role text;
BEGIN
  FOR r IN SELECT p.oid, p.proname, p.prosecdef, p.proconfig
             FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace
              AND p.pronargs = 0
              AND p.proname IN ('trg_opp_lifecycle_block_mutation',
                                'trg_opp_disposition_block_mutation',
                                'trg_opp_disposition_snooze_guard')
  LOOP
    IF r.prosecdef THEN
      RAISE EXCEPTION 'OPP-TRGFN postcondition: public.%() must be SECURITY INVOKER', r.proname;
    END IF;
    IF r.proconfig IS NULL OR NOT ('search_path=pg_catalog, public' = ANY (r.proconfig)) THEN
      RAISE EXCEPTION 'OPP-TRGFN postcondition: public.%() must pin search_path = pg_catalog, public, found %', r.proname, r.proconfig;
    END IF;
    -- has_function_privilege folds in PUBLIC, so anon/authenticated = false
    -- also proves PUBLIC no longer holds EXECUTE.
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role)
         AND has_function_privilege(v_role, r.oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'OPP-TRGFN postcondition: % still has EXECUTE on public.%()', v_role, r.proname;
      END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM aclexplode(COALESCE((SELECT proacl FROM pg_proc WHERE oid = r.oid), '{}'::aclitem[])) a
                WHERE a.grantee = 0) THEN
      RAISE EXCEPTION 'OPP-TRGFN postcondition: PUBLIC still holds a privilege on public.%()', r.proname;
    END IF;
  END LOOP;

  -- The triggers themselves are untouched and still enabled.
  SELECT count(*) INTO v_n
    FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
   WHERE NOT t.tgisinternal AND t.tgenabled = 'O'
     AND ((t.tgrelid = 'public.opportunity_lifecycle_states'::regclass
           AND t.tgname IN ('opp_lifecycle_block_update', 'opp_lifecycle_block_delete')
           AND p.proname = 'trg_opp_lifecycle_block_mutation')
       OR (t.tgrelid = 'public.opportunity_dispositions'::regclass
           AND t.tgname IN ('opp_disposition_block_update', 'opp_disposition_block_delete')
           AND p.proname = 'trg_opp_disposition_block_mutation')
       OR (t.tgrelid = 'public.opportunity_dispositions'::regclass
           AND t.tgname = 'opp_disposition_snooze_guard'
           AND p.proname = 'trg_opp_disposition_snooze_guard'));
  IF v_n <> 5 THEN
    RAISE EXCEPTION 'OPP-TRGFN postcondition: expected 5 enabled opportunity triggers on these functions, found %', v_n;
  END IF;

  RAISE NOTICE 'OPP-TRGFN: 3 opportunity trigger functions — no PUBLIC/anon/authenticated EXECUTE, search_path pinned, INVOKER, 5 triggers enabled — verified.';
END
$verify$;

COMMIT;

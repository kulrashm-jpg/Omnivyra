-- ROLLBACK for 20270112000002_prospect_score_evaluations_erasure_redaction.sql
--
-- ─── ORDER ─────────────────────────────────────────────────────────────────
-- Reverse version order, one transaction per file:
--   (20270113000000 A6-10 bridge, if applied) → 20270112000005 →
--   20270112000004 → 20270112000003 → 20270112000002 (this file) →
--   20270112000001 → 20270112000000.
-- REFUSES while anything other than this migration's own functions still
-- calls pi_erasure_redact_score_evaluations / pi_score_evaluation_redaction_marker
-- (i.e. pi_person_erasure_finalize from 20270112000003 — roll that back first).
--
-- ─── WHAT IT RESTORES ──────────────────────────────────────────────────────
--   * public.prospect_score_evaluations_immutable() — the 20261031000000 body,
--     verbatim: unconditional RAISE, SECURITY INVOKER,
--     SET search_path = public, pg_temp (SEC-B leaves this function's existing
--     pin alone, so this is the pre-migration proconfig with or without SEC-B).
--     The trigger trg_prospect_score_evaluations_immutable was never changed.
--   * its ACL. The forward migration ran REVOKE ALL FROM PUBLIC, anon,
--     authenticated, service_role. Before that the function carried the ACL it
--     was CREATED with (20261031000000 granted/revoked nothing on it): the
--     owner's default function privileges = the global pg_default_acl entry for
--     the owner (or the built-in acldefault, EXECUTE to PUBLIC) plus any
--     schema-public entry for the owner. This file recomputes that ACL from the
--     catalog and re-grants it exactly. If SEC-B
--     (20270110000004_function_execute_classwide_hardening; renumbered from 20270110000003) is in force it had
--     already revoked PUBLIC, anon and authenticated from this function, so
--     those three are NOT re-granted. SEC-B witness:
--     public.ws3_protect_task_provenance() pinned to "pg_catalog, public" (same
--     SEC-B class-T treatment; untouched by every erasure migration).
--     EXECUTE on a trigger function is never checked when the trigger fires, so
--     this grant changes no write path; it is restored only so the catalog
--     matches the pre-migration state.
--
-- ─── REMOVES ───────────────────────────────────────────────────────────────
--   pi_erasure_redact_score_evaluations(uuid, uuid), pi_score_evaluation_redaction_marker()
--   (the trigger function is replaced first, so nothing references the marker).
--
-- ─── WHAT IT DOES NOT DO ───────────────────────────────────────────────────
-- Evaluations already redacted by an erasure (person_id NULL, explanation
-- columns emptied, facets = {"redacted": true, "reason": "person_erased"})
-- STAY redacted: irreversible by design, and this rollback never writes a row.
-- Nothing in the restored schema rejects such rows (person_id is nullable and
-- the trigger is BEFORE UPDATE only). After this rollback a person with any
-- score evaluation is unerasable again (the append-only trigger aborts the
-- FK's ON DELETE SET NULL) — that is the pre-migration defect, restored.

BEGIN;

DO $rollback_guard$
DECLARE
  v_dep      text;
  v_redacted bigint;
BEGIN
  IF to_regprocedure('public.prospect_score_evaluations_immutable()') IS NULL THEN
    RAISE EXCEPTION '20270112000002 rollback refused: prospect_score_evaluations_immutable() is missing';
  END IF;
  IF to_regprocedure('public.pi_erasure_redact_score_evaluations(uuid, uuid)') IS NULL
     OR to_regprocedure('public.pi_score_evaluation_redaction_marker()') IS NULL THEN
    RAISE EXCEPTION '20270112000002 rollback refused: the redaction functions are missing (not applied, or already rolled back)';
  END IF;
  IF to_regprocedure('public.ws3_protect_task_provenance()') IS NULL THEN
    RAISE EXCEPTION '20270112000002 rollback refused: the SEC-B witness public.ws3_protect_task_provenance() is missing';
  END IF;

  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text) INTO v_dep
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND p.proname NOT IN ('pi_erasure_redact_score_evaluations', 'pi_score_evaluation_redaction_marker',
                           'prospect_score_evaluations_immutable')
     AND (p.prosrc LIKE '%pi_erasure_redact_score_evaluations%' OR p.prosrc LIKE '%pi_score_evaluation_redaction_marker%');
  IF v_dep IS NOT NULL THEN
    RAISE EXCEPTION '20270112000002 rollback refused: still called by % - roll back 20270112000003 first', v_dep;
  END IF;

  SELECT count(*) INTO v_redacted FROM public.prospect_score_evaluations
   WHERE person_id IS NULL AND facets = '{"redacted": true, "reason": "person_erased"}'::jsonb;
  RAISE NOTICE '20270112000002 rollback: % evaluation(s) were redacted by erasures and stay redacted', v_redacted;
END
$rollback_guard$;

-- 20261031000000_pi_score_evaluations.sql, verbatim.
CREATE OR REPLACE FUNCTION public.prospect_score_evaluations_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION
    'prospect_score_evaluations is append-only: evaluation % may not be modified (record a new evaluation instead)', OLD.id
    USING ERRCODE = '23514';
END
$$;

-- Pre-migration ACL (see header).
DO $acl$
DECLARE
  c_fn     constant text := 'public.prospect_score_evaluations_immutable()';
  v_oid    oid := 'public.prospect_score_evaluations_immutable()'::regprocedure;
  v_owner  oid;
  v_target aclitem[];
  v_secb   boolean;
  r        record;
BEGIN
  SELECT p.proowner INTO v_owner FROM pg_proc p WHERE p.oid = v_oid;
  v_target := coalesce(
      (SELECT d.defaclacl FROM pg_default_acl d
        WHERE d.defaclrole = v_owner AND d.defaclnamespace = 0 AND d.defaclobjtype = 'f'),
      acldefault('f', v_owner))
    || coalesce(
      (SELECT d.defaclacl FROM pg_default_acl d
        WHERE d.defaclrole = v_owner AND d.defaclnamespace = 'public'::regnamespace AND d.defaclobjtype = 'f'),
      '{}'::aclitem[]);
  v_secb := (SELECT proconfig FROM pg_proc WHERE oid = 'public.ws3_protect_task_provenance()'::regprocedure)
              IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog, public'];

  -- 1. clear every non-owner grant currently present
  FOR r IN SELECT DISTINCT a.grantee
             FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
            WHERE p.oid = v_oid AND a.grantee <> v_owner LOOP
    IF r.grantee = 0 THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', c_fn);
    ELSE
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', c_fn, pg_get_userbyid(r.grantee));
    END IF;
  END LOOP;

  -- 2. re-grant the creation-time ACL (minus what SEC-B revoked, if in force)
  FOR r IN SELECT a.grantee, bool_or(a.is_grantable) AS grantable
             FROM aclexplode(v_target) a
            WHERE a.grantee <> v_owner AND a.privilege_type = 'EXECUTE'
              AND NOT (v_secb AND (a.grantee = 0 OR pg_get_userbyid(a.grantee) IN ('anon', 'authenticated')))
            GROUP BY a.grantee LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %s%s', c_fn,
                   CASE WHEN r.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(r.grantee)) END,
                   CASE WHEN r.grantable THEN ' WITH GRANT OPTION' ELSE '' END);
  END LOOP;
END
$acl$;

DROP FUNCTION public.pi_erasure_redact_score_evaluations(uuid, uuid);
DROP FUNCTION public.pi_score_evaluation_redaction_marker();

DO $verify$
DECLARE
  v_src text; v_cfg text[]; v_def boolean;
BEGIN
  SELECT prosrc, proconfig, prosecdef INTO v_src, v_cfg, v_def
    FROM pg_proc WHERE oid = 'public.prospect_score_evaluations_immutable()'::regprocedure;
  IF v_def OR v_cfg IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
     OR position('pi_erasure_authorization_held' IN v_src) > 0 THEN
    RAISE EXCEPTION '20270112000002 rollback postcondition: prospect_score_evaluations_immutable is not the 20261031000000 definition';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t
                  WHERE t.tgrelid = 'public.prospect_score_evaluations'::regclass
                    AND t.tgname = 'trg_prospect_score_evaluations_immutable'
                    AND t.tgfoid = 'public.prospect_score_evaluations_immutable()'::regprocedure
                    AND t.tgenabled <> 'D') THEN
    RAISE EXCEPTION '20270112000002 rollback postcondition: the immutability trigger is missing or disabled';
  END IF;
  IF to_regprocedure('public.pi_erasure_redact_score_evaluations(uuid, uuid)') IS NOT NULL
     OR to_regprocedure('public.pi_score_evaluation_redaction_marker()') IS NOT NULL THEN
    RAISE EXCEPTION '20270112000002 rollback postcondition: a redaction function survived';
  END IF;
END
$verify$;

COMMIT;

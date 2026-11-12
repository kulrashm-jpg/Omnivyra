-- hard_delete_company refuses a company that still has CONTENT with a NAMED exception, before any
-- delete. Version 20270217000029 reserved by the registry owner (83, registry 3de345859). Ruling: e9,
-- 2026-11-13 (option 3: RESTRICT deliberately, never a raw 23503).
--
-- WHY. 20270217000025 makes campaigns.company_id NOT NULL + ON DELETE RESTRICT, and
-- 20270217000028 adds scheduled_posts.company_id NOT NULL + ON DELETE RESTRICT. The applied
-- public.hard_delete_company (20261210000001; prod prosrc md5 632ddc62639822a7bfe5a4c85d114f0e, CRLF,
-- 83 C26) deletes only user_company_roles, company_profiles and companies, so for a company with a
-- campaign or a scheduled post its final DELETE fails with a bare 23503 and the whole function rolls
-- back. Nothing is deleted (correct), but the operator gets a constraint name, not a diagnosis.
--
-- OPERATOR-VISIBLE CHANGE (025 + 028 + 029 together, all unapplied as of writing): a company that has
-- ANY campaign OR ANY scheduled post cannot be hard-deleted. The function now says so up front:
--   RAISE 'COMPANY_HAS_CONTENT' (P0001), DETAIL '<n> campaign(s), <m> scheduled post(s); ...'
-- raised after the existing checks (null company, missing reason, COMPANY_NOT_FOUND,
-- COMPANY_HOLDS_SUPER_ADMIN_MEMBERSHIP) and BEFORE any DELETE, so nothing partially runs.
-- Soft-delete / disable stays the normal way to retire a company; content is never deleted silently.
--
-- WHAT IS UNCHANGED. Signature, RETURNS TABLE(deleted_memberships integer, deleted_profiles integer),
-- SECURITY DEFINER, SET search_path = public, every existing check and message, the delete order.
-- The new body is the applied body plus one DECLARE pair and one guarded block (diff in the review).
--
-- PRECONDITION (identity, not a repo file): the live prosrc must be the applied 20261210000001 body
-- (md5 of prosrc with CR removed = c6ab4be202337450548e1190c8c2d034, i.e. the CRLF prod form
-- 632ddc62... or its LF form), or already this migration's body (re-apply = no-op). Anything else RAISEs:
-- someone changed the function and this migration must not overwrite it blind.
-- ORDER. Apply AFTER 20270217000028 (the body reads scheduled_posts.company_id).
-- GRANTS re-asserted: EXECUTE for service_role only (REVOKE from PUBLIC, anon, authenticated).
-- Postcondition ($verify$): body identity, SECURITY DEFINER, search_path=public, grants.
-- Rollback: rollbacks/hard_delete_company_named_dependents_rollback.sql restores the pre-image body
--   verbatim (from 20261210000001) and the same grants.
-- Proof (CI): backend/tests/realschema/hard_delete_company_named_dependents.test.ts.

BEGIN;

DO $preflight$
DECLARE
  v_md5 text;
BEGIN
  IF to_regprocedure('public.hard_delete_company(uuid, uuid, text)') IS NULL THEN
    RAISE EXCEPTION 'HDC-029 preflight: public.hard_delete_company(uuid, uuid, text) not found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.scheduled_posts'::regclass
                  AND attname = 'company_id' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'HDC-029 preflight: scheduled_posts.company_id missing; apply 20270217000028 first';
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_md5
    FROM pg_proc WHERE oid = 'public.hard_delete_company(uuid, uuid, text)'::regprocedure;
  IF v_md5 NOT IN ('c6ab4be202337450548e1190c8c2d034', '3f2c47120b18bb9e0d98d95e74fcbb29') THEN
    RAISE EXCEPTION 'HDC-029 preflight: hard_delete_company body is not the applied 20261210000001 body nor this migration''s (md5 % after CR removal); refusing to overwrite', v_md5;
  END IF;
END
$preflight$;

CREATE OR REPLACE FUNCTION public.hard_delete_company(p_company_id uuid, p_actor uuid, p_reason text)
RETURNS TABLE(deleted_memberships integer, deleted_profiles integer)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_super_admins INTEGER := 0;
  v_memberships  INTEGER := 0;
  v_profiles     INTEGER := 0;
  v_campaigns    INTEGER := 0;
  v_posts        INTEGER := 0;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'HARD_DELETE_COMPANY_NULL_COMPANY';
  END IF;
  IF p_reason IS NULL OR LENGTH(TRIM(p_reason)) = 0 THEN
    RAISE EXCEPTION 'HARD_DELETE_COMPANY_MISSING_REASON';
  END IF;

  PERFORM 1 FROM companies WHERE id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMPANY_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  SELECT COUNT(*) INTO v_super_admins
    FROM user_company_roles
   WHERE company_id = p_company_id
     AND status = 'active'
     AND upper(btrim(role)) = 'SUPER_ADMIN';
  IF v_super_admins > 0 THEN
    RAISE EXCEPTION 'COMPANY_HOLDS_SUPER_ADMIN_MEMBERSHIP'
      USING ERRCODE = 'P0001',
            DETAIL  = format('%s active SUPER_ADMIN membership(s); revoke through identity.admin.revoke first', v_super_admins);
  END IF;

  -- 20270217000029: campaigns and scheduled_posts reference companies ON DELETE RESTRICT (025, 028).
  -- Refuse by name, before any delete, instead of a bare 23503 from the final DELETE.
  SELECT COUNT(*) INTO v_campaigns FROM campaigns WHERE company_id = p_company_id;
  SELECT COUNT(*) INTO v_posts FROM scheduled_posts WHERE company_id = p_company_id;
  IF v_campaigns > 0 OR v_posts > 0 THEN
    RAISE EXCEPTION 'COMPANY_HAS_CONTENT'
      USING ERRCODE = 'P0001',
            DETAIL  = format('%s campaign(s), %s scheduled post(s); content is never deleted with a company: handle it first, or soft-delete / disable the company instead', v_campaigns, v_posts);
  END IF;

  -- Non-active SUPER_ADMIN rows confer nothing and are removed with the rest.
  DELETE FROM user_company_roles WHERE company_id = p_company_id;
  GET DIAGNOSTICS v_memberships = ROW_COUNT;
  DELETE FROM company_profiles WHERE company_id = p_company_id::text;   -- company_profiles.company_id is text
  GET DIAGNOSTICS v_profiles = ROW_COUNT;
  -- 238 FKs reference companies: 224 cascade, 9 set null, 5 do not (users.active_company_id, whatsapp_*,
  -- campaign_cost_breakdown): a referencing row now aborts the WHOLE
  -- function (23503) instead of leaving the memberships/profile deleted.
  DELETE FROM companies WHERE id = p_company_id;

  RETURN QUERY SELECT v_memberships, v_profiles;
END;
$$;

REVOKE ALL ON FUNCTION public.hard_delete_company(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hard_delete_company(uuid, uuid, text) TO service_role;

DO $verify$
DECLARE
  v_fn oid := 'public.hard_delete_company(uuid, uuid, text)'::regprocedure;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = v_fn AND md5(replace(prosrc, E'\r', '')) = '3f2c47120b18bb9e0d98d95e74fcbb29') THEN
    RAISE EXCEPTION 'HDC-029 verify: hard_delete_company body is not this migration''s';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = v_fn AND prosecdef AND proconfig @> ARRAY['search_path=public']::text[]) THEN
    RAISE EXCEPTION 'HDC-029 verify: hard_delete_company must be SECURITY DEFINER with search_path=public';
  END IF;
  IF has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                 WHERE p.oid = v_fn AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'HDC-029 verify: hard_delete_company is executable by PUBLIC/anon/authenticated';
  END IF;
  IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'HDC-029 verify: service_role lost EXECUTE on hard_delete_company';
  END IF;
END
$verify$;

COMMIT;

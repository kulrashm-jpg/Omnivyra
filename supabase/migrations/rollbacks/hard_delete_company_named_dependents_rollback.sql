-- Rollback for 20270217000029_hard_delete_company_named_dependents.sql.
-- Restores the PRE-IMAGE of public.hard_delete_company VERBATIM (copied from 20261210000001, whose body
-- with CRLF line endings is the applied prod prosrc, md5 632ddc62639822a7bfe5a4c85d114f0e, 83 C26) and
-- the same grants. Line endings: this file is LF, so after rollback prosrc md5 is the LF form
-- c6ab4be202337450548e1190c8c2d034 (same text; 029's preflight accepts both).
-- After this, a company with campaigns or scheduled posts again fails hard delete with a bare 23503
-- (still deleting nothing). Refuses if the live body is neither 029's nor the pre-image. Idempotent.

BEGIN;

DO $identity$
DECLARE
  v_md5 text;
BEGIN
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_md5
    FROM pg_proc WHERE oid = 'public.hard_delete_company(uuid, uuid, text)'::regprocedure;
  IF v_md5 NOT IN ('3f2c47120b18bb9e0d98d95e74fcbb29', 'c6ab4be202337450548e1190c8c2d034') THEN
    RAISE EXCEPTION 'HDC-029 rollback: hard_delete_company body is neither 029''s nor the pre-image (md5 %); refusing to overwrite', v_md5;
  END IF;
END
$identity$;

CREATE OR REPLACE FUNCTION public.hard_delete_company(p_company_id uuid, p_actor uuid, p_reason text)
RETURNS TABLE(deleted_memberships integer, deleted_profiles integer)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_super_admins INTEGER := 0;
  v_memberships  INTEGER := 0;
  v_profiles     INTEGER := 0;
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
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.hard_delete_company(uuid, uuid, text)'::regprocedure
                  AND md5(replace(prosrc, E'\r', '')) = 'c6ab4be202337450548e1190c8c2d034') THEN
    RAISE EXCEPTION 'HDC-029 rollback verify: pre-image not restored';
  END IF;
END
$verify$;

COMMIT;

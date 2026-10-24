-- ════════════════════════════════════════════════════════════════════════════
-- PROPOSAL — Closure-015L. NOT A MIGRATION. Not executed. RECOMMENDED, not
-- required for the invariant (01_… is the safety boundary on its own).
--
-- Purpose: remove the deadlock window described in 01_… by making the governed
-- writer take the company lock BEFORE it touches the membership row — the same
-- lock order as the lifecycle functions (companies → user_company_roles). It
-- also replaces bootstrap-super-admin's read-then-write assignSuperAdmin (two
-- separate PostgREST statements) with one transaction.
--
-- Adoption is a coordinated change: pages/api/admin/bootstrap-super-admin.ts
-- assignSuperAdmin() must call this RPC instead of its select + update/insert.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.assign_super_admin(p_user_id uuid, p_company_id uuid)
RETURNS TABLE(role_row_id uuid, company_id uuid)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_status  text;
  v_deleted timestamptz;
  v_row     uuid;
BEGIN
  IF p_user_id IS NULL OR p_company_id IS NULL THEN
    RAISE EXCEPTION 'ASSIGN_SUPER_ADMIN_MISSING_ARGUMENT';
  END IF;

  -- Lock order: company first (FOR SHARE: governed grants do not block each other).
  SELECT c.status, c.deleted_at INTO v_status, v_deleted
    FROM companies c WHERE c.id = p_company_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SUPER_ADMIN_MEMBERSHIP_COMPANY_MISSING' USING ERRCODE = 'P0001';
  END IF;
  IF v_deleted IS NOT NULL OR v_status <> 'active' THEN
    RAISE EXCEPTION 'SUPER_ADMIN_MEMBERSHIP_COMPANY_NOT_ACTIVE' USING ERRCODE = 'P0001';
  END IF;

  -- Then the membership row(s) of this pair, locked.
  SELECT r.id INTO v_row
    FROM user_company_roles r
   WHERE r.user_id = p_user_id AND r.company_id = p_company_id
   ORDER BY (r.status = 'active') DESC, r.created_at DESC NULLS LAST
   LIMIT 1
     FOR UPDATE;

  IF v_row IS NULL THEN
    INSERT INTO user_company_roles (user_id, company_id, role, status, created_at, updated_at)
    VALUES (p_user_id, p_company_id, 'SUPER_ADMIN', 'active', now(), now())
    RETURNING id INTO v_row;
  ELSE
    UPDATE user_company_roles
       SET role = 'SUPER_ADMIN', status = 'active', deactivated_at = NULL, updated_at = now()
     WHERE id = v_row;
  END IF;

  RETURN QUERY SELECT v_row, p_company_id;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_super_admin(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assign_super_admin(uuid, uuid) TO service_role;

COMMIT;

-- ROLLBACK: DROP FUNCTION IF EXISTS public.assign_super_admin(uuid, uuid);
--           (and revert the bootstrap-super-admin adoption).

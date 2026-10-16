-- Promoted by Closure-015O from supabase/proposals/closure015n/02_assign_super_admin_rpc.sql (sha256 3f4e83e596b10f74f963ee482c9a95031da17ce5f41a9bb761ac2081dda1e5f2).
-- Adjustments vs the proposal (if any) are listed in docs/security/CLOSURE_015O_MIGRATION_PROMOTION_REVIEW.md §4.
-- Closure-015P (owner decision 2): this migration ALSO adds the database-level restriction on direct
-- application-role SUPER_ADMIN grants. It re-creates public.guard_super_admin_membership_company()
-- (installed by 20261210000001) with one added refusal, SUPER_ADMIN_GRANT_NOT_GOVERNED, when the
-- executing role (current_user) is an application role (service_role, authenticated, anon or
-- authenticator) and the write CREATES a SUPER_ADMIN membership (any status), changes a role INTO
-- SUPER_ADMIN, ACTIVATES a SUPER_ADMIN membership or moves one to another company.
-- The governed path, public.assign_super_admin (SECURITY DEFINER, below), executes the write as its
-- OWNER, so current_user inside the trigger is the owner and the grant passes. Bootstrap and env-
-- credential bootstrap call that RPC; break-glass (an operator session as the database owner /
-- postgres) is not an application role and is unaffected. The trigger function stays INVOKER-rights
-- on purpose: SECURITY DEFINER would make current_user the function owner for every caller and
-- erase the distinction. It is placed in THIS migration so the RPC and the restriction arrive in the
-- same transaction: the application falls back to its direct two-statement grant only when the RPC is
-- missing (PGRST202), which can then only happen while the restriction is also absent.
-- Revocation, deactivation, non-SUPER_ADMIN writes and no-transition updates are not restricted.
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

-- ── Closure-015P: direct application-role grant restriction ───────────────────
-- Identical to the 20261210000001 body except for v_grant and the SUPER_ADMIN_GRANT_NOT_GOVERNED block.
CREATE OR REPLACE FUNCTION public.guard_super_admin_membership_company()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_status  text;
  v_deleted timestamptz;
  v_grant   boolean := false;
BEGIN
  -- Closure-015P: an application role may not CREATE a SUPER_ADMIN membership (any status), change
  -- a role INTO SUPER_ADMIN, ACTIVATE a SUPER_ADMIN membership or move one to another company.
  -- current_user is the role executing the statement; inside the SECURITY DEFINER
  -- public.assign_super_admin it is that function's owner, so the governed grant passes.
  -- Revocation (role away from SUPER_ADMIN), deactivation and DELETE are not restricted.
  IF current_user IN ('service_role', 'authenticated', 'anon', 'authenticator')
     AND upper(btrim(NEW.role)) = 'SUPER_ADMIN' THEN
    IF TG_OP = 'INSERT' THEN
      v_grant := true;
    ELSIF upper(btrim(OLD.role)) IS DISTINCT FROM 'SUPER_ADMIN' THEN
      v_grant := true;   -- role changed into SUPER_ADMIN
    ELSIF NEW.status = 'active' AND OLD.status IS DISTINCT FROM 'active' THEN
      v_grant := true;   -- activation (e.g. invited → active)
    ELSIF OLD.company_id IS DISTINCT FROM NEW.company_id THEN
      v_grant := true;   -- moved to another company
    END IF;
    IF v_grant THEN
      RAISE EXCEPTION 'SUPER_ADMIN_GRANT_NOT_GOVERNED'
        USING ERRCODE = 'P0001',
              DETAIL  = format('role %s may not create or activate a SUPER_ADMIN membership directly', current_user),
              HINT    = 'use public.assign_super_admin(user_id, company_id)';
    END IF;
  END IF;

  -- Only writes that PRODUCE an active SUPER_ADMIN row are guarded.
  IF NEW.status IS DISTINCT FROM 'active' OR upper(btrim(NEW.role)) <> 'SUPER_ADMIN' THEN
    RETURN NEW;
  END IF;
  -- No transition: the row already was an active SUPER_ADMIN of this company
  -- (e.g. an updated_at touch). Lifecycle step 2 already sees it.
  IF TG_OP = 'UPDATE'
     AND OLD.status = 'active'
     AND upper(btrim(OLD.role)) = 'SUPER_ADMIN'
     AND OLD.company_id = NEW.company_id THEN
    RETURN NEW;
  END IF;

  SELECT c.status, c.deleted_at
    INTO v_status, v_deleted
    FROM public.companies c
   WHERE c.id = NEW.company_id
     FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SUPER_ADMIN_MEMBERSHIP_COMPANY_MISSING'
      USING ERRCODE = 'P0001',
            DETAIL  = format('company %s does not exist', NEW.company_id);
  END IF;
  IF v_deleted IS NOT NULL OR v_status <> 'active' THEN
    RAISE EXCEPTION 'SUPER_ADMIN_MEMBERSHIP_COMPANY_NOT_ACTIVE'
      USING ERRCODE = 'P0001',
            DETAIL  = format('company %s status=%s soft_deleted=%s', NEW.company_id, v_status, v_deleted IS NOT NULL);
  END IF;
  RETURN NEW;
END;
$$;

-- Preconditions for the distinction to hold: the trigger exists (20261210000001), the guard is
-- invoker-rights, and the governed RPC is NOT owned by an application role.
DO $$
DECLARE v_owner text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_guard_super_admin_membership_company'
                  AND tgrelid = 'public.user_company_roles'::regclass AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'DIRECT_GRANT_GUARD_PRECONDITION: trg_guard_super_admin_membership_company is missing — apply 20261210000001 first';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.guard_super_admin_membership_company()'::regprocedure) THEN
    RAISE EXCEPTION 'DIRECT_GRANT_GUARD_PRECONDITION: guard_super_admin_membership_company must be invoker-rights';
  END IF;
  SELECT pg_get_userbyid(proowner) INTO v_owner FROM pg_proc
   WHERE oid = 'public.assign_super_admin(uuid, uuid)'::regprocedure;
  IF v_owner IN ('service_role', 'authenticated', 'anon', 'authenticator') THEN
    RAISE EXCEPTION 'DIRECT_GRANT_GUARD_PRECONDITION: assign_super_admin is owned by application role %', v_owner;
  END IF;
END $$;

COMMIT;

-- ROLLBACK: supabase/migrations/rollbacks/assign_super_admin_rpc_and_direct_grant_guard_rollback.sql
--           (restores the 20261210000001 guard body, then drops assign_super_admin).

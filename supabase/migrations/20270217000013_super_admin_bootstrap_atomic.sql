-- 20270217000013 - super-admin bootstrap, ATOMIC (M1; e1; e9-approved BLOCKING privilege 2026-11-13; version reassigned to
-- e1 by virality-83 in 8f3104784; review: virality-05).
--
-- WHY. pages/api/admin/bootstrap-super-admin.ts (modes 'bootstrap' and 'env-credential') decides "no SUPER_ADMIN exists
-- yet" with a COUNT read and then grants in a SEPARATE call (assign_super_admin). Two concurrent bootstraps can both
-- read 0 and both promote; and the count's error was discarded (`count ?? 0`), so a FAILED read meant "none exists" -
-- the branch that permits the bootstrap. This migration moves the zero-check INSIDE the granting transaction.
--
-- WHAT.
--   1. public.super_admin_membership_lock_key() - the ONE definition of the advisory-lock key shared by every writer
--      that decides on the platform's super-admin COUNT: this bootstrap and M2's revoke (20270217000052). Both call
--      this function; neither spells the number. The TS constant SUPER_ADMIN_MEMBERSHIP_LOCK_KEY
--      (backend/security/superAdminMembershipLock.ts) is pinned to it by a test (05: two constants that merely happen
--      to match are the failure mode).
--   2. public.bootstrap_first_super_admin(p_user_id, p_company_id): takes the transaction-scoped advisory lock, counts
--      ACTIVE SUPER_ADMIN memberships, refuses BOOTSTRAP_ALREADY_CONSUMED if any exists, else grants through
--      public.assign_super_admin (the governed writer: company lock first, then the membership row) in the SAME
--      transaction. The lock serialises bootstrap against bootstrap AND against M2's revoke.
--   SECURITY DEFINER (it must call assign_super_admin as its owner, which the direct-grant guard requires), search_path
--   pinned, EXECUTE for service_role only. Authorization stays in the route (env credentials + token, or passkey +
--   step-up); this function is the atomicity boundary, not the auth boundary.
-- IDEMPOTENT: CREATE OR REPLACE; re-running changes nothing.

DO $preflight$
BEGIN
  IF to_regprocedure('public.assign_super_admin(uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION '013 preflight: public.assign_super_admin(uuid, uuid) is missing (20261210000002)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_company_roles' AND column_name = 'status')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_company_roles' AND column_name = 'role') THEN
    RAISE EXCEPTION '013 preflight: user_company_roles.role / status missing';
  END IF;
END
$preflight$;

CREATE OR REPLACE FUNCTION public.super_admin_membership_lock_key()
RETURNS bigint
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog
AS $$ SELECT 7302118001::bigint $$;

REVOKE ALL ON FUNCTION public.super_admin_membership_lock_key() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.super_admin_membership_lock_key() TO service_role;

CREATE OR REPLACE FUNCTION public.bootstrap_first_super_admin(p_user_id uuid, p_company_id uuid)
RETURNS TABLE(role_row_id uuid, company_id uuid)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
#variable_conflict use_column
DECLARE
  v_existing int;
BEGIN
  IF p_user_id IS NULL OR p_company_id IS NULL THEN
    RAISE EXCEPTION 'BOOTSTRAP_MISSING_ARGUMENT' USING ERRCODE = 'P0001';
  END IF;
  -- Serialise every count-deciding super-admin writer (bootstrap, revoke) for the rest of this transaction.
  PERFORM pg_advisory_xact_lock(public.super_admin_membership_lock_key());
  SELECT count(*) INTO v_existing
    FROM public.user_company_roles r
   WHERE upper(btrim(r.role)) = 'SUPER_ADMIN' AND r.status = 'active';
  IF v_existing > 0 THEN
    RAISE EXCEPTION 'BOOTSTRAP_ALREADY_CONSUMED' USING ERRCODE = 'P0001',
      DETAIL = format('%s active SUPER_ADMIN membership(s) exist', v_existing);
  END IF;
  RETURN QUERY SELECT a.role_row_id, a.company_id FROM public.assign_super_admin(p_user_id, p_company_id) a;
END;
$$;

REVOKE ALL ON FUNCTION public.bootstrap_first_super_admin(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_first_super_admin(uuid, uuid) TO service_role;

-- POSTCONDITION: both functions exist with the intended security posture; the key is the pinned literal.
DO $verify$
DECLARE
  r text;
BEGIN
  IF public.super_admin_membership_lock_key() <> 7302118001 THEN
    RAISE EXCEPTION '013 postcondition: super_admin_membership_lock_key() is not the pinned value';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.bootstrap_first_super_admin(uuid, uuid)'::regprocedure) THEN
    RAISE EXCEPTION '013 postcondition: bootstrap_first_super_admin must be SECURITY DEFINER';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.bootstrap_first_super_admin(uuid, uuid)'::regprocedure
                    AND proconfig @> ARRAY['search_path=pg_catalog, public']) THEN
    RAISE EXCEPTION '013 postcondition: bootstrap_first_super_admin search_path is not pinned';
  END IF;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_function_privilege(r, 'public.bootstrap_first_super_admin(uuid, uuid)', 'EXECUTE')
       OR has_function_privilege(r, 'public.super_admin_membership_lock_key()', 'EXECUTE') THEN
      RAISE EXCEPTION '013 postcondition: % can execute a super-admin bootstrap function', r;
    END IF;
  END LOOP;
END
$verify$;

-- ROLLBACK: supabase/migrations/rollbacks/super_admin_bootstrap_atomic_rollback.sql

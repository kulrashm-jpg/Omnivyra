-- 20270217000052 - revoke super-admin: LAST-SUPER-ADMIN guard + atomic downgrade (M2; e1; e9-approved BLOCKING
-- privilege 2026-11-13; version reserved by virality-83 in 8f3104784; review: virality-05).
--
-- WHY. pages/api/admin/revoke-super-admin.ts downgraded users.role and then every SUPER_ADMIN membership in two
-- separate statements, with no count: it would revoke the LAST super-admin (self-revoke included) and lock the platform
-- out of its own administration, and a failure between the statements left a half-revoked user. The membership trigger
-- (guard_super_admin_membership_company) returns early for any write that does not PRODUCE an active SUPER_ADMIN row,
-- so it never inspects a demotion. Positive control for "there is no guard": the same search finds the company
-- lifecycle's COMPANY_HOLDS_SUPER_ADMIN_MEMBERSHIP count guards (20261210000001).
--
-- WHAT. public.revoke_super_admin(p_user_id): ONE transaction that
--   1. takes the advisory lock shared with M1's bootstrap (public.super_admin_membership_lock_key(), 20270217000013), so
--      two concurrent revokes of the last two super-admins serialise: the second one re-counts and is refused;
--   2. counts the OTHER users holding an ACTIVE SUPER_ADMIN membership who can still AUTHENTICATE: users row present,
--      not soft-deleted, and users.status = 'active' (NULL treated as active). An ALLOWLIST on purpose (05): a suspended
--      user is refused by IdentityResolver and cannot administer anything, and an unknown future status must make the
--      count SMALLER (refuse the revoke - an inconvenience), never larger (permit removing the last usable admin - a
--      lockout);
--   3. refuses LAST_SUPER_ADMIN (P0001) when the target holds an active SUPER_ADMIN membership and no other user does -
--      an explicit, typed refusal, not an incidental error;
--   4. otherwise downgrades users.role and EVERY SUPER_ADMIN membership of the target (any status; role compared
--      case/space-insensitively, as the trigger does) to COMPANY_ADMIN, and returns the affected company ids.
--   SECURITY DEFINER, search_path pinned, EXECUTE for service_role only. Authorization (identity.admin.revoke + step-up)
--   stays in the route.
-- IDEMPOTENT: CREATE OR REPLACE; re-running changes nothing.

DO $preflight$
BEGIN
  -- 013 runs first (version order) and defines the shared key; refuse to build a revoke with its own key.
  IF to_regprocedure('public.super_admin_membership_lock_key()') IS NULL THEN
    RAISE EXCEPTION '052 preflight: public.super_admin_membership_lock_key() is missing - apply 20270217000013 first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'role')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'is_deleted')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'updated_at')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'status') THEN
    RAISE EXCEPTION '052 preflight: users.role / is_deleted / updated_at / status missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_company_roles' AND column_name = 'updated_at') THEN
    RAISE EXCEPTION '052 preflight: user_company_roles.updated_at missing';
  END IF;
END
$preflight$;

CREATE OR REPLACE FUNCTION public.revoke_super_admin(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_target_active boolean;
  v_others        int;
  v_companies     uuid[];
  v_users_row     int;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'REVOKE_SUPER_ADMIN_MISSING_ARGUMENT' USING ERRCODE = 'P0001';
  END IF;
  PERFORM pg_advisory_xact_lock(public.super_admin_membership_lock_key());

  SELECT EXISTS (SELECT 1 FROM public.user_company_roles r
                  WHERE r.user_id = p_user_id AND upper(btrim(r.role)) = 'SUPER_ADMIN' AND r.status = 'active')
    INTO v_target_active;
  SELECT count(DISTINCT r.user_id) INTO v_others
    FROM public.user_company_roles r
    JOIN public.users u ON u.id = r.user_id
   WHERE upper(btrim(r.role)) = 'SUPER_ADMIN' AND r.status = 'active'
     AND r.user_id <> p_user_id
     AND coalesce(u.is_deleted, false) = false
     AND coalesce(u.status, 'active') = 'active';
  IF v_target_active AND v_others = 0 THEN
    RAISE EXCEPTION 'LAST_SUPER_ADMIN' USING ERRCODE = 'P0001',
      DETAIL = 'revoking this user would leave the platform with no active super-admin';
  END IF;

  UPDATE public.users SET role = 'COMPANY_ADMIN', updated_at = now()
   WHERE id = p_user_id AND upper(btrim(role)) = 'SUPER_ADMIN';
  GET DIAGNOSTICS v_users_row = ROW_COUNT;

  WITH d AS (
    UPDATE public.user_company_roles r SET role = 'COMPANY_ADMIN', updated_at = now()
     WHERE r.user_id = p_user_id AND upper(btrim(r.role)) = 'SUPER_ADMIN'
    RETURNING r.company_id)
  SELECT coalesce(array_agg(d.company_id), '{}') INTO v_companies FROM d;

  RETURN jsonb_build_object(
    'users_role_downgraded', v_users_row > 0,
    'downgraded_company_ids', to_jsonb(v_companies),
    'remaining_super_admins', v_others);
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_super_admin(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_super_admin(uuid) TO service_role;

DO $verify$
DECLARE
  r text;
BEGIN
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.revoke_super_admin(uuid)'::regprocedure) THEN
    RAISE EXCEPTION '052 postcondition: revoke_super_admin must be SECURITY DEFINER';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.revoke_super_admin(uuid)'::regprocedure
                    AND proconfig @> ARRAY['search_path=pg_catalog, public']) THEN
    RAISE EXCEPTION '052 postcondition: revoke_super_admin search_path is not pinned';
  END IF;
  -- The body must take the SHARED key, never a literal of its own.
  IF position('public.super_admin_membership_lock_key()' IN
       (SELECT prosrc FROM pg_proc WHERE oid = 'public.revoke_super_admin(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '052 postcondition: revoke_super_admin does not take the shared super-admin lock';
  END IF;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_function_privilege(r, 'public.revoke_super_admin(uuid)', 'EXECUTE') THEN
      RAISE EXCEPTION '052 postcondition: % can execute revoke_super_admin', r;
    END IF;
  END LOOP;
END
$verify$;

-- ROLLBACK: supabase/migrations/rollbacks/revoke_super_admin_last_admin_guard_rollback.sql

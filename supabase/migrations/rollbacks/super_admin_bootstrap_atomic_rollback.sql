-- Rollback of 20270217000013_super_admin_bootstrap_atomic.sql (e1, M1).
-- Drops ONLY what 013 created. The shared lock key is also used by 20270217000052's revoke_super_admin, so the
-- rollback refuses while that function exists: roll back 052 first.
DO $rb$
BEGIN
  IF to_regprocedure('public.revoke_super_admin(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION '013 rollback: public.revoke_super_admin(uuid) (20270217000052) still uses the shared lock key - roll back 052 first';
  END IF;
END
$rb$;
DROP FUNCTION IF EXISTS public.bootstrap_first_super_admin(uuid, uuid);
DROP FUNCTION IF EXISTS public.super_admin_membership_lock_key();

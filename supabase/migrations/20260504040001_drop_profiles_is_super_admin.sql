-- Phase D cleanup: drop the deprecated `profiles.is_super_admin` flag.
--
-- Canonical super-admin state lives in `user_company_roles.role = 'SUPER_ADMIN'`
-- (resolved via `isPlatformSuperAdmin(userId)` in backend/services/rbacService.ts).
-- All code references to `profiles.is_super_admin` were removed in Phase D.
--
-- REPLAY-SAFE: `profiles` is not in canonical baseline (it lives in the
-- ~335-table drift bucket — Phase E2..E7). On a fresh DB the table doesn't
-- exist, so the DROP COLUMN must be guarded by a table-existence check;
-- otherwise replay fails with `relation "profiles" does not exist`.
-- The DROP COLUMN IF EXISTS handles re-applies; the outer guard handles
-- first-apply on a fresh DB.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'profiles'
  ) THEN
    ALTER TABLE public.profiles DROP COLUMN IF EXISTS is_super_admin;
  END IF;
END $$;

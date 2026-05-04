-- Phase D cleanup: drop the deprecated `profiles.is_super_admin` flag.
--
-- Canonical super-admin state lives in `user_company_roles.role = 'SUPER_ADMIN'`
-- (resolved via `isPlatformSuperAdmin(userId)` in backend/services/rbacService.ts).
-- All code references to `profiles.is_super_admin` were removed in Phase D.
--
-- Safety:
--   * No application code reads or writes this column anymore (verified via
--     codebase grep before this migration was authored).
--   * `user_company_roles` already contains the SUPER_ADMIN rows for every
--     active platform admin; nothing is being lost by dropping the flag.

BEGIN;

ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS is_super_admin;

COMMIT;

-- Rollback of 20270217000042_users_active_company_pointer_cleared_on_membership_exit.sql (e1).
-- Drops the trigger and its function. Pointers the trigger cleared meanwhile stay NULL (sync-supabase-user
-- re-derives them from an active membership at the next login); after this, deactivations mint stale pointers again.
DROP TRIGGER IF EXISTS user_company_roles_clear_active_company_pointer ON public.user_company_roles;
DROP FUNCTION IF EXISTS public.users_clear_active_company_on_membership_exit();

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.user_company_roles'::regclass
              AND tgname = 'user_company_roles_clear_active_company_pointer' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'rollback: trigger still exists';
  END IF;
  IF to_regprocedure('public.users_clear_active_company_on_membership_exit()') IS NOT NULL THEN
    RAISE EXCEPTION 'rollback: function still exists';
  END IF;
END
$verify$;

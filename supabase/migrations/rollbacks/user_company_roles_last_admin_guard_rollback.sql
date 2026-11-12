-- Rollback of 20270217000012_user_company_roles_last_admin_guard.
-- Sound by PROVENANCE (05's rollback rule): every object name below originates
-- in 20270217000012 itself, so nothing else could have created them. Triggers are
-- dropped FIRST, then the functions WITHOUT CASCADE - if anything else depends on
-- a function, the rollback must STOP rather than silently remove a dependant
-- (05: never DROP FUNCTION ... CASCADE).
DROP TRIGGER IF EXISTS trg_company_admin_last_active_check ON public.user_company_roles;
DROP TRIGGER IF EXISTS trg_company_admin_last_active_lock ON public.user_company_roles;
DROP FUNCTION IF EXISTS public.company_admin_last_active_check();
DROP FUNCTION IF EXISTS public.company_admin_last_active_lock();

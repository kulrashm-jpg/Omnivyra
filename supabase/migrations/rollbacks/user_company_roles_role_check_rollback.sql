-- Rollback of 20270217000011_user_company_roles_role_check: removes the role
-- CHECK (no data is touched). NOT NULL is deliberately LEFT in place: role is
-- NOT NULL in prod already (supabase/_schema/baseline.sql), so the migration's
-- SET NOT NULL only asserts it, and dropping it here would remove a constraint
-- this migration never added.
ALTER TABLE public.user_company_roles DROP CONSTRAINT IF EXISTS user_company_roles_role_check;

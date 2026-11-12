-- Rollback of 20270217000011_user_company_roles_role_check: removes the role
-- CHECK (no data is touched).
ALTER TABLE public.user_company_roles DROP CONSTRAINT IF EXISTS user_company_roles_role_check;

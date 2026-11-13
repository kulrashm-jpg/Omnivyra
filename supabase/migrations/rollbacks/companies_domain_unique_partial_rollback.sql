-- Rollback of 20270217000050_companies_domain_unique_partial.sql (e1). Drops the two partial unique indexes; the app's
-- fail-closed claimed-domain gate (P2) remains the primary defence.
DROP INDEX IF EXISTS public.idx_companies_website_domain_unique;
DROP INDEX IF EXISTS public.idx_companies_admin_email_domain_unique;
ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_website_domain_canonical;
ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_admin_email_domain_canonical;

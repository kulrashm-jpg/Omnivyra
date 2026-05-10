-- Cleanup + protection for the companies.website corruption identified in
-- the GA integration audit (rows where website is the company's own UUID).
--
-- Background: prior writer paths (auth/sync-supabase-user.ts and
-- admin/access-requests/approve.ts) inserted a UUID placeholder into
-- `website` to satisfy a stale NOT NULL assumption. The column is in fact
-- nullable. The placeholder rows then poisoned domain-based tenant
-- resolvers (e.g. resolveOmnivyraWebsiteCompany).
--
-- This migration:
--   1. Nulls out any row whose website equals its own id (the only
--      pattern observed).
--   2. Also nulls rows whose website is otherwise a bare UUID, since the
--      same writer pattern could leave residue from race-loser cleanup.
--   3. Adds a CHECK constraint so future writes can never persist
--      website=id::text again.

UPDATE public.companies
   SET website = NULL
 WHERE website IS NOT NULL
   AND website = id::text;

UPDATE public.companies
   SET website = NULL
 WHERE website IS NOT NULL
   AND website ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

ALTER TABLE public.companies
  DROP CONSTRAINT IF EXISTS companies_website_not_company_id;

ALTER TABLE public.companies
  ADD CONSTRAINT companies_website_not_company_id
  CHECK (website IS NULL OR website <> id::text);

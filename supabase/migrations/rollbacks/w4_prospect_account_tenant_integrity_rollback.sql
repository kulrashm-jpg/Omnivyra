-- ROLLBACK — W4: prospect account activation + tenant-integrity closure.
-- Reverses supabase/migrations/20260923000000_w4_prospect_account_tenant_integrity.sql
--
-- SAFETY
-- ------
-- The forward migration writes no rows: it replaces three foreign keys with
-- tenant-safe equivalents and adds two unique indexes. This rollback restores
-- the previous simple foreign keys and drops those indexes. No data is lost in
-- either direction — the same rows satisfy both shapes, because every existing
-- row is already tenant-consistent (verified: 0 cross-tenant claims).
--
-- WHAT ROLLING BACK COSTS
-- -----------------------
-- It REOPENS W3-AUDIT-1. After this runs, a claim owned by tenant A can once
-- again name a person or account belonging to tenant B, and the database will
-- accept it. That is the precise hole W4 was commissioned to close, so rolling
-- back is only defensible if the constraints themselves broke something worse.
-- Fixing forward is almost always correct.
--
-- It also restores ON DELETE SET NULL on the two account edges, which is
-- weaker: deleting an account would silently detach its people and claims
-- rather than refusing until the references are handled.
--
-- ORDER
-- -----
-- Composite constraints are dropped before their parent indexes, because each
-- FK depends on the unique index it references. One transaction.
--
-- NOT TOUCHED: no legacy table, no row, no column. leads, contacts,
-- canonical_leads, lead_intelligence and lead_intelligence_events are not
-- referenced here.
--
-- NOTE: rollback files are deliberately non-idempotent and are exempt from the
-- migration quality gate (scripts/check-migration-quality.js).

DO $$
DECLARE
  cross_claims  bigint;
  linked_people bigint;
BEGIN
  SELECT count(*) INTO cross_claims FROM public.identity_claims ic
   WHERE ic.person_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.unified_persons u
                      WHERE u.id = ic.person_id AND u.company_id = ic.organization_id);
  SELECT count(*) INTO linked_people FROM public.unified_persons WHERE account_id IS NOT NULL;

  RAISE NOTICE 'w4_rollback: reopening cross-tenant identity references. % cross-tenant claim(s) present, % person(s) linked to an account.',
    cross_claims, linked_people;

  -- 1. tenant-safe constraints out
  ALTER TABLE public.unified_persons  DROP CONSTRAINT IF EXISTS unified_persons_account_tenant_fk;
  ALTER TABLE public.identity_claims  DROP CONSTRAINT IF EXISTS identity_claims_account_tenant_fk;
  ALTER TABLE public.identity_claims  DROP CONSTRAINT IF EXISTS identity_claims_person_tenant_fk;

  -- 2. previous simple constraints back
  ALTER TABLE public.identity_claims
    ADD CONSTRAINT identity_claims_person_id_fkey
      FOREIGN KEY (person_id) REFERENCES public.unified_persons(id) ON DELETE CASCADE;

  ALTER TABLE public.identity_claims
    ADD CONSTRAINT identity_claims_account_id_fkey
      FOREIGN KEY (account_id) REFERENCES public.prospect_accounts(id) ON DELETE SET NULL;

  ALTER TABLE public.unified_persons
    ADD CONSTRAINT unified_persons_account_id_fkey
      FOREIGN KEY (account_id) REFERENCES public.prospect_accounts(id) ON DELETE SET NULL;

  -- 3. indexes that existed only to support the composite keys
  DROP INDEX IF EXISTS public.uq_prospect_accounts_org_source_ref;
  DROP INDEX IF EXISTS public.uq_prospect_accounts_id_org;
END $$;

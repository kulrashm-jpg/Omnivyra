-- ROLLBACK — W1: canonical prospect / identity foundation.
-- Reverses supabase/migrations/20260920000000_w1_prospect_identity_foundation.sql
--
-- SAFETY
-- ------
-- The forward migration creates two EMPTY tables and adds one nullable column.
-- It writes no rows and migrates no data, so at the moment of application this
-- rollback has ZERO data-loss exposure: every unified_persons.account_id is
-- NULL and both new tables are empty.
--
-- That property is lost as soon as the foundation is populated. identity_claims
-- is the only durable record of WHY two records were treated as one person —
-- the resolver's verdict is otherwise merely logged — so dropping it destroys
-- reasoning that cannot be reconstructed from the spine. prospect_accounts is
-- likewise the only place an external company exists as an entity.
--
-- The guards below therefore refuse to drop once either table holds rows, or
-- once any person has been attached to an account. Bypassing them is a
-- deliberate, evidence-destroying act and must be an explicit operator
-- decision, not an incidental rollback.
--
-- Dropped in dependency order: identity_claims (references both) →
-- unified_persons.account_id (references prospect_accounts) → prospect_accounts.
-- Indexes and triggers are dropped implicitly with their tables; the column's
-- indexes are dropped explicitly because the table survives.
--
-- Nothing here touches a legacy lead model. `leads`, `contacts`, `active_leads`,
-- `canonical_leads`, `lead_intelligence` and `lead_intelligence_profiles` were
-- never modified by W1 and are not referenced here.
--
-- NOTE: rollback files are deliberately non-idempotent and are exempt from the
-- migration quality gate (scripts/check-migration-quality.js).

DO $$
DECLARE
  claim_rows   bigint := 0;
  account_rows bigint := 0;
  linked_rows  bigint := 0;
BEGIN
  IF to_regclass('public.identity_claims') IS NOT NULL THEN
    SELECT count(*) INTO claim_rows FROM public.identity_claims;
  END IF;
  IF to_regclass('public.prospect_accounts') IS NOT NULL THEN
    SELECT count(*) INTO account_rows FROM public.prospect_accounts;
  END IF;
  SELECT count(*) INTO linked_rows FROM public.unified_persons WHERE account_id IS NOT NULL;

  IF claim_rows > 0 OR account_rows > 0 OR linked_rows > 0 THEN
    RAISE EXCEPTION
      'w1_rollback_refused: % identity_claims, % prospect_accounts, % linked persons. Dropping these destroys identity provenance that cannot be reconstructed. Resolve deliberately before rolling back.',
      claim_rows, account_rows, linked_rows
      USING ERRCODE = 'restrict_violation';
  END IF;
END $$;

DROP TABLE IF EXISTS public.identity_claims;

DROP INDEX IF EXISTS public.idx_unified_persons_company_account;
DROP INDEX IF EXISTS public.idx_unified_persons_account;

ALTER TABLE public.unified_persons
  DROP COLUMN IF EXISTS account_id;

DROP TABLE IF EXISTS public.prospect_accounts;

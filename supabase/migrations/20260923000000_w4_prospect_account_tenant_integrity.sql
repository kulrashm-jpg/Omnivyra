-- W4 — prospect account activation + tenant-integrity closure.
--
-- Closes the cross-tenant hole the W3 audit found, extends the same guard to
-- the account relationships W4 makes canonical, and gives prospect accounts a
-- second deterministic identity key. Creates no row, migrates no data.
--
-- ─── THE DEFECT THIS EXISTS TO CLOSE (W3-AUDIT-1) ──────────────────────────
-- `identity_claims.person_id` referenced `unified_persons(id)` through a SIMPLE
-- foreign key. Tenant was never part of the reference, so a claim owned by
-- tenant A could name a person belonging to tenant B and the database accepted
-- it. Reproduced immediately before authoring, on all three relationships:
--
--   identity_claims.person_id   -> another tenant's person   ACCEPTED
--   identity_claims.account_id  -> another tenant's account  ACCEPTED
--   unified_persons.account_id  -> another tenant's account  ACCEPTED
--
-- Production holds zero such rows and no code path produces one, so this is a
-- latent hole rather than a live leak. But `identity_claims` is the table whose
-- entire purpose is tenant-scoped identity, and it was the one table without
-- the structural guard W2 had already established for `lead_intelligence`.
-- Application correctness was the only thing standing between the model and a
-- cross-tenant identity assertion.
--
-- ─── THE FIX IS THE PATTERN, NOT A NEW IDEA ────────────────────────────────
-- W2 solved exactly this for intelligence with
--   lead_intelligence_person_tenant_fk (unified_person_id, company_id)
--     -> unified_persons (id, company_id)
-- which in turn followed canonical_leads -> canonical_users(id, company_id)
-- from 20260409. W4 applies the same composite-key shape to all three
-- remaining relationships. Nothing here is invented.
--
-- MATCH SIMPLE (the default) means each constraint is skipped when its
-- nullable leg is NULL. That is required, not incidental: the ten unresolved
-- contact claims carry person_id NULL and must stay legal, and a person may be
-- known before their account is.
--
-- ─── WHY ON DELETE RESTRICT, WHERE SET NULL WAS USED BEFORE ────────────────
-- The previous simple FKs used ON DELETE SET NULL. That is not expressible on
-- a composite key here: the second leg (`organization_id` / `company_id`) is
-- NOT NULL, so PostgreSQL cannot null the pair. The choice is therefore
-- CASCADE or RESTRICT.
--
-- CASCADE would let deleting one account delete identity evidence, and
-- identity_claims is the only durable record of WHY a person is believed to be
-- a given person. RESTRICT preserves it: an account still referenced cannot be
-- deleted until the references are dealt with deliberately.
--
-- This costs nothing today — prospect_accounts holds 0 rows — and it matches
-- the reasoning W2 recorded for the person link. The person->claims edge keeps
-- its existing CASCADE, because a claim is an assertion ABOUT a person and has
-- no meaning once its subject is gone; changing that would be an unrequested
-- semantic change.
--
-- ─── SECOND ACCOUNT IDENTITY KEY ───────────────────────────────────────────
-- prospect_accounts could only be identified by normalized domain. Real
-- external prospects frequently arrive from a provider that issues its own
-- stable account id, and a domain may be absent at that moment. Rather than
-- add a column, this makes the provenance fields the table ALREADY has
-- (`source`, `source_reference`) a deterministic, tenant-scoped identity:
--
--   UNIQUE (organization_id, source, source_reference) WHERE
--     source_reference IS NOT NULL AND status = 'active'
--
-- Tenant-scoped like every other key here: two tenants may each hold their own
-- account for the same provider record, because they are separate objects with
-- separate intelligence.
--
-- Scope: 2 new unique indexes, 3 foreign keys replaced with tenant-safe
-- equivalents. No column added, altered or dropped; no row written; no legacy
-- table touched. Idempotent.
--
-- Rollback: supabase/migrations/rollbacks/w4_prospect_account_tenant_integrity_rollback.sql

DO $$
BEGIN
  -- ── 1. parent keys the composite foreign keys need ──────────────────────
  -- unified_persons(id, company_id) already exists from W2
  -- (uq_unified_persons_id_company). prospect_accounts needs its equivalent.
  CREATE UNIQUE INDEX IF NOT EXISTS uq_prospect_accounts_id_org
    ON public.prospect_accounts (id, organization_id);

  -- ── 2. second deterministic account identity ────────────────────────────
  CREATE UNIQUE INDEX IF NOT EXISTS uq_prospect_accounts_org_source_ref
    ON public.prospect_accounts (organization_id, source, source_reference)
    WHERE source_reference IS NOT NULL AND status = 'active';

  -- ── 3. identity_claims.person_id — THE W3-AUDIT-1 FIX ───────────────────
  IF EXISTS (SELECT 1 FROM pg_constraint
             WHERE conrelid='public.identity_claims'::regclass
               AND conname='identity_claims_person_id_fkey') THEN
    ALTER TABLE public.identity_claims DROP CONSTRAINT identity_claims_person_id_fkey;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid='public.identity_claims'::regclass
                   AND conname='identity_claims_person_tenant_fk') THEN
    ALTER TABLE public.identity_claims
      ADD CONSTRAINT identity_claims_person_tenant_fk
        FOREIGN KEY (person_id, organization_id)
        REFERENCES public.unified_persons (id, company_id)
        ON DELETE CASCADE;
  END IF;

  -- ── 4. identity_claims.account_id ───────────────────────────────────────
  IF EXISTS (SELECT 1 FROM pg_constraint
             WHERE conrelid='public.identity_claims'::regclass
               AND conname='identity_claims_account_id_fkey') THEN
    ALTER TABLE public.identity_claims DROP CONSTRAINT identity_claims_account_id_fkey;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid='public.identity_claims'::regclass
                   AND conname='identity_claims_account_tenant_fk') THEN
    ALTER TABLE public.identity_claims
      ADD CONSTRAINT identity_claims_account_tenant_fk
        FOREIGN KEY (account_id, organization_id)
        REFERENCES public.prospect_accounts (id, organization_id)
        ON DELETE RESTRICT;
  END IF;

  -- ── 5. unified_persons.account_id — the canonical person->account edge ──
  IF EXISTS (SELECT 1 FROM pg_constraint
             WHERE conrelid='public.unified_persons'::regclass
               AND conname='unified_persons_account_id_fkey') THEN
    ALTER TABLE public.unified_persons DROP CONSTRAINT unified_persons_account_id_fkey;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid='public.unified_persons'::regclass
                   AND conname='unified_persons_account_tenant_fk') THEN
    ALTER TABLE public.unified_persons
      ADD CONSTRAINT unified_persons_account_tenant_fk
        FOREIGN KEY (account_id, company_id)
        REFERENCES public.prospect_accounts (id, organization_id)
        ON DELETE RESTRICT;
  END IF;
END $$;

COMMENT ON CONSTRAINT identity_claims_person_tenant_fk ON public.identity_claims IS
  'W4 / W3-AUDIT-1: a claim may only name a person in its OWN tenant. Replaces a simple FK that accepted cross-tenant references. MATCH SIMPLE keeps person_id NULL legal for unresolved observations.';

COMMENT ON CONSTRAINT unified_persons_account_tenant_fk ON public.unified_persons IS
  'W4: the canonical person -> prospect account edge, tenant-safe. ON DELETE RESTRICT because an account with people attached must be resolved deliberately, not silently detached.';

COMMENT ON INDEX public.uq_prospect_accounts_org_source_ref IS
  'Second deterministic account identity: a provider/source record maps to at most one ACTIVE account per tenant. Reuses the existing source/source_reference provenance fields rather than adding a column.';

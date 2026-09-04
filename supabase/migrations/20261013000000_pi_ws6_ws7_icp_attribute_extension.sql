-- PI WS-6 / WS-7 — the ICP attribute extension the frozen manifest requires.
--
-- IMPLEMENTATION-MANIFEST-001 §17 lists eight fields as REQUIRED — NOT YET
-- IMPLEMENTED. This migration adds the SIX that are intrinsic attributes of an
-- account or a person, and therefore storable as source-asserted facts.
--
-- The remaining two — account `product/service alignment` and person `problem
-- relevance` — are deliberately NOT added here. Both are FIT concepts: a
-- relationship between the tenant's offering and the prospect, not a property
-- the prospect has on its own. Storing a fit as an asserted attribute would let
-- one tenant's fit be written onto an entity another tenant also observes, and
-- would make an ICP criterion match against a value the ICP itself produced.
-- They need a product decision about where fit lives before a column exists.
--
-- ─── WHY THESE COLUMNS AND NOT AN ATTRIBUTE BAG ────────────────────────────
-- `prospectIcp/criteria.ts` is a CLOSED vocabulary over real columns, by
-- contract: "an ICP may only speak about attributes the platform actually
-- stores, because a criterion naming `account.mrr` would be permanently
-- `unknown` and would look like a data gap rather than the modelling error it
-- is." A jsonb bag would satisfy the schema and break that contract.
--
-- ─── ADDITIVE AND REVERSIBLE ───────────────────────────────────────────────
-- Every column is nullable with no default, so existing rows are untouched and
-- no backfill is implied. `IF NOT EXISTS` throughout: a second run is a no-op
-- rather than a competing definition (the P2A precedent, 20261005000000).
--
-- ─── TENANT SAFETY ─────────────────────────────────────────────────────────
-- No new tenant key is introduced. `prospect_accounts` is already keyed on
-- `organization_id` and `unified_persons` on `company_id`, and every existing
-- composite foreign key is untouched, so these columns inherit the isolation
-- their tables already enforce.

-- ── ACCOUNT (WS-6, FR-16 company ICP) ──────────────────────────────────────
ALTER TABLE public.prospect_accounts
  ADD COLUMN IF NOT EXISTS market         text,
  ADD COLUMN IF NOT EXISTS business_model text,
  ADD COLUMN IF NOT EXISTS growth_stage   text;

COMMENT ON COLUMN public.prospect_accounts.market IS
  'PI WS-6 FR-16. The market/segment a source asserted this account operates in. Free text: no vocabulary is imposed, for the same reason revenue_band and funding_stage impose none — provider vocabularies differ and a wrong-but-plausible normalisation is worse than the raw assertion.';
COMMENT ON COLUMN public.prospect_accounts.business_model IS
  'PI WS-6 FR-16. How the account makes money, as asserted (e.g. subscription, marketplace, services). Free text, no imposed vocabulary.';
COMMENT ON COLUMN public.prospect_accounts.growth_stage IS
  'PI WS-6 FR-16. Growth stage as asserted. Named growth_STAGE rather than growth because a stage is a stateable fact a source can assert, whereas a growth RATE would be a derived metric with a window and a denominator this table does not carry.';

-- ── PERSON (WS-7, FR-21 buying role) ───────────────────────────────────────
ALTER TABLE public.unified_persons
  ADD COLUMN IF NOT EXISTS authority   text,
  ADD COLUMN IF NOT EXISTS influence   text,
  ADD COLUMN IF NOT EXISTS buying_role text;

COMMENT ON COLUMN public.unified_persons.authority IS
  'PI WS-7 FR-21. Decision authority as asserted by a source. Free text: the Playbook names the concept but fixes no vocabulary, and inventing one here would make it the contract.';
COMMENT ON COLUMN public.unified_persons.influence IS
  'PI WS-7 FR-21. Influence as asserted by a source. Free text, same reasoning as authority.';
COMMENT ON COLUMN public.unified_persons.buying_role IS
  'PI WS-7 FR-21. Buying role from the CLOSED vocabulary the Playbook fixes (§17). Constrained below because this vocabulary IS specified, unlike authority and influence.';

-- ── CONSTRAINTS ────────────────────────────────────────────────────────────
-- Blank strings are refused everywhere. An empty string is not an observation:
-- it reads as "we know the value and it is nothing", which no source ever means.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'prospect_accounts_ws6_attributes_not_blank'
      AND conrelid = 'public.prospect_accounts'::regclass
  ) THEN
    ALTER TABLE public.prospect_accounts
      ADD CONSTRAINT prospect_accounts_ws6_attributes_not_blank CHECK (
        (market         IS NULL OR length(btrim(market))         > 0) AND
        (business_model IS NULL OR length(btrim(business_model)) > 0) AND
        (growth_stage   IS NULL OR length(btrim(growth_stage))   > 0)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'unified_persons_ws7_attributes_not_blank'
      AND conrelid = 'public.unified_persons'::regclass
  ) THEN
    ALTER TABLE public.unified_persons
      ADD CONSTRAINT unified_persons_ws7_attributes_not_blank CHECK (
        (authority IS NULL OR length(btrim(authority)) > 0) AND
        (influence IS NULL OR length(btrim(influence)) > 0)
      );
  END IF;

  -- buying_role is the ONE of the six with a vocabulary the Playbook actually
  -- fixes (§17: decision maker, economic buyer, champion, influencer,
  -- evaluator, blocker, unknown). It is constrained for the same reason
  -- unified_persons_seniority_valid is: the database is the authority, and the
  -- TypeScript array mirrors it rather than the other way round.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'unified_persons_buying_role_valid'
      AND conrelid = 'public.unified_persons'::regclass
  ) THEN
    ALTER TABLE public.unified_persons
      ADD CONSTRAINT unified_persons_buying_role_valid CHECK (
        buying_role IS NULL OR buying_role IN (
          'decision_maker', 'economic_buyer', 'champion',
          'influencer', 'evaluator', 'blocker', 'unknown'
        )
      );
  END IF;
END $$;

-- ── INDEXES ────────────────────────────────────────────────────────────────
-- Tenant-first and partial, mirroring the existing firmographic indexes: an ICP
-- criterion filters within one tenant, and rows with no asserted value are not
-- worth indexing.
CREATE INDEX IF NOT EXISTS idx_prospect_accounts_org_market
  ON public.prospect_accounts (organization_id, market) WHERE market IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prospect_accounts_org_business_model
  ON public.prospect_accounts (organization_id, business_model) WHERE business_model IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_unified_persons_company_buying_role
  ON public.unified_persons (company_id, buying_role) WHERE buying_role IS NOT NULL;

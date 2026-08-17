-- ============================================================================
-- P2A — prospect_accounts firmographic completion
--
-- Adds the SIX firmographic attributes that LI-1 did not: revenue, founding
-- year, technology stack and funding. Everything else the Phase 1B audit listed
-- as "missing" — industry, employee_count, employee_band, country_code, region,
-- city — was ALREADY added by 20261001000000_li1_canonical_attribute_surface.
-- That report was wrong on those six, and this migration deliberately does not
-- re-add them: a second ADD COLUMN would be a no-op at best and a competing
-- definition at worst.
--
-- ─── WHY TYPED COLUMNS AND NOT metadata ────────────────────────────────────
-- `prospect_accounts.metadata` already exists and could hold all of this. It is
-- the wrong home: the entire purpose of these attributes is to be FILTERABLE —
-- "employees 100-500, industry SaaS, Series B" is the query the ICP work
-- eventually has to answer, and a jsonb blob cannot be indexed usefully for
-- range predicates without committing to expression indexes per attribute.
--
-- ─── EVERY COLUMN IS NULLABLE, AND STAYS THAT WAY ──────────────────────────
-- No provider supplies every attribute. A NOT NULL here would force ingestion
-- to invent a value, which is exactly the fabrication this programme refuses
-- everywhere else. Absent means absent.
--
-- ─── SAFE BY CONSTRUCTION ──────────────────────────────────────────────────
-- Additive only: no column is dropped, renamed, retyped or backfilled, and no
-- existing constraint is altered. `prospect_accounts` holds ZERO rows in
-- production at the time of writing, so there is nothing to migrate and no
-- lock of consequence — but the migration is written to be correct even if that
-- were not true.
-- ============================================================================

DO $preflight$
BEGIN
  IF to_regclass('public.prospect_accounts') IS NULL THEN
    RAISE EXCEPTION 'P2A preflight: public.prospect_accounts is missing';
  END IF;

  -- LI-1 is the prerequisite: this migration COMPLETES the firmographic
  -- surface, so running it against a table that never received LI-1's columns
  -- would leave a half-defined model that later code cannot rely on.
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.prospect_accounts'::regclass
       AND attname  = 'industry'
       AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'P2A preflight: prospect_accounts.industry is missing — apply LI-1 first';
  END IF;
END
$preflight$;

ALTER TABLE public.prospect_accounts
  ADD COLUMN IF NOT EXISTS annual_revenue  numeric,
  ADD COLUMN IF NOT EXISTS revenue_band    text,
  ADD COLUMN IF NOT EXISTS founded_year    integer,
  ADD COLUMN IF NOT EXISTS technologies    jsonb,
  ADD COLUMN IF NOT EXISTS funding_stage   text,
  ADD COLUMN IF NOT EXISTS last_funding_at timestamptz;

-- ── Constraints ─────────────────────────────────────────────────────────────
-- Only rules the repository ALREADY established are applied here.
--   • non-blank text mirrors `prospect_accounts_firmographics_not_blank` (LI-1)
--   • `>= 0` mirrors `prospect_accounts_employee_count_valid` (LI-1)
-- No speculative business rule is invented. In particular there is NO
-- allow-list on revenue_band or funding_stage: the repository has no canonical
-- vocabulary for either (companyIntelligence uses free strings for a different
-- domain — the tenant's own company, not a prospect), and inventing one here
-- would force every future provider to translate into a vocabulary no provider
-- uses. That vocabulary decision belongs with the first real provider.
DO $p2a_checks$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prospect_accounts_firmographics_p2a_not_blank') THEN
    ALTER TABLE public.prospect_accounts ADD CONSTRAINT prospect_accounts_firmographics_p2a_not_blank CHECK (
      (revenue_band  IS NULL OR length(btrim(revenue_band))  > 0) AND
      (funding_stage IS NULL OR length(btrim(funding_stage)) > 0)
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prospect_accounts_annual_revenue_valid') THEN
    ALTER TABLE public.prospect_accounts ADD CONSTRAINT prospect_accounts_annual_revenue_valid CHECK (
      annual_revenue IS NULL OR annual_revenue >= 0
    );
  END IF;

  -- A founding year is bounded because an out-of-range value is a parsing bug,
  -- not a business judgement. The upper bound is deliberately generous rather
  -- than `now()`: a CHECK cannot use a non-immutable function, and a hard
  -- current-year bound would need re-issuing every January.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prospect_accounts_founded_year_valid') THEN
    ALTER TABLE public.prospect_accounts ADD CONSTRAINT prospect_accounts_founded_year_valid CHECK (
      founded_year IS NULL OR (founded_year >= 1800 AND founded_year <= 2200)
    );
  END IF;

  -- `technologies` is a LIST of technology names. Constraining it to an array
  -- stops a caller storing an object or a bare string, which would silently
  -- break every future containment query.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prospect_accounts_technologies_is_array') THEN
    ALTER TABLE public.prospect_accounts ADD CONSTRAINT prospect_accounts_technologies_is_array CHECK (
      technologies IS NULL OR jsonb_typeof(technologies) = 'array'
    );
  END IF;
END
$p2a_checks$;

-- ── Indexes ─────────────────────────────────────────────────────────────────
-- TENANT FIRST, always: every existing index on this table leads with
-- `organization_id` (see idx_prospect_accounts_org_status), because every real
-- query is tenant-scoped and a bare attribute index would be unusable for them.
-- That convention is preserved rather than replaced — this migration introduces
-- no new tenant model.
--
-- Indexed: the attributes an ICP filter ranges or groups over. Partial on NOT
-- NULL, because a sparsely-populated firmographic means most rows would
-- otherwise be dead weight in the index.
--
-- NOT indexed, deliberately:
--   • revenue_band / funding_stage — low-cardinality labels that arrive with a
--     tenant predicate already; the org index does the work. Add them when a
--     real query proves otherwise.
--   • last_funding_at, technologies — no query exists yet. A GIN index on
--     technologies is the obvious future move for containment search, and is
--     left for the phase that actually issues that query.
CREATE INDEX IF NOT EXISTS idx_prospect_accounts_org_industry
  ON public.prospect_accounts (organization_id, industry)
  WHERE industry IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_prospect_accounts_org_employee_count
  ON public.prospect_accounts (organization_id, employee_count)
  WHERE employee_count IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_prospect_accounts_org_annual_revenue
  ON public.prospect_accounts (organization_id, annual_revenue)
  WHERE annual_revenue IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_prospect_accounts_org_country
  ON public.prospect_accounts (organization_id, country_code)
  WHERE country_code IS NOT NULL;

-- ── Verification ────────────────────────────────────────────────────────────
DO $verify$
DECLARE
  v_cols INT;
  v_chk  INT;
  v_idx  INT;
BEGIN
  SELECT count(*) INTO v_cols
    FROM pg_attribute
   WHERE attrelid = 'public.prospect_accounts'::regclass
     AND NOT attisdropped
     AND attname IN ('annual_revenue','revenue_band','founded_year','technologies','funding_stage','last_funding_at');
  IF v_cols <> 6 THEN
    RAISE EXCEPTION 'P2A verify: expected 6 firmographic columns, found %', v_cols;
  END IF;

  SELECT count(*) INTO v_chk
    FROM pg_constraint
   WHERE conname IN (
     'prospect_accounts_firmographics_p2a_not_blank',
     'prospect_accounts_annual_revenue_valid',
     'prospect_accounts_founded_year_valid',
     'prospect_accounts_technologies_is_array');
  IF v_chk <> 4 THEN
    RAISE EXCEPTION 'P2A verify: expected 4 check constraints, found %', v_chk;
  END IF;

  SELECT count(*) INTO v_idx
    FROM pg_indexes
   WHERE schemaname = 'public'
     AND indexname IN (
       'idx_prospect_accounts_org_industry',
       'idx_prospect_accounts_org_employee_count',
       'idx_prospect_accounts_org_annual_revenue',
       'idx_prospect_accounts_org_country');
  IF v_idx <> 4 THEN
    RAISE EXCEPTION 'P2A verify: expected 4 indexes, found %', v_idx;
  END IF;
END
$verify$;

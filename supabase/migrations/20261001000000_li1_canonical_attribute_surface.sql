-- LI-1 — canonical attribute surface for the person and account spine.
--
-- WHY. W1–W6 built an identity spine that can prove WHO someone is and which
-- tenant owns them, but not WHAT they are. `unified_persons` holds only email,
-- phone and external keys; `prospect_accounts` holds only naming and domain.
-- The LI-0 audit confirmed this is not a gap in one table but the absence of a
-- layer: a search across all 821 public tables found no canonical person
-- attribute surface and no prospect firmographic surface anywhere. Enrichment
-- has nowhere to land, and ICP / readiness / prioritisation are not expressible.
--
-- WHAT THIS IS NOT. No ingestion, no provider, no enrichment execution, no
-- readiness, no duplicate classification. This migration adds storage and the
-- constraints that keep it honest. Nothing writes to these columns yet except
-- the one backfill described below.
--
-- ─── THE SEMANTIC TRAP THIS MIGRATION MUST NOT SPRING ──────────────────────
--   unified_persons.company_id      = TENANT        (FK -> companies)
--   unified_persons.account_id      = PROSPECT EMPLOYER (FK -> prospect_accounts)
--   prospect_accounts.organization_id = TENANT      (FK -> companies)
-- No employer information is written into any *_id column named company_id or
-- organization_id. The employer lives in `account_id` and nowhere else.
--
-- ─── WHAT IS DELIBERATELY *NOT* ADDED ──────────────────────────────────────
--   linkedin_url  - LinkedIn identity is EVIDENCE, not an attribute. It already
--                   has two homes: identity_claims (claim_type='external_profile'
--                   with platform='linkedin', already permitted by
--                   identity_claims_platform_rule) and unified_persons.external_keys
--                   for resolution. A third home would be a second identity model.
--   email / phone - already canonical on unified_persons.
--   name/domain/website on accounts - already present.
--   per-field provider values - that is the LI-2 source-record layer. These
--                   columns hold the CHOSEN value only; `attributes_source`
--                   records which source last wrote the block, which is a
--                   deliberate half-step, not a substitute for LI-2.
--
-- Every column is NULLable and additive. No existing column is altered, renamed
-- or dropped. No new unique constraint, foreign key or index is created:
-- attributes are not identity (W4 established that a name is never an identity
-- key), and filtering indexes are premature against 23 persons and 0 accounts —
-- they belong with LI-8 when there is data to filter.
--
-- Rollback: supabase/migrations/rollbacks/li1_canonical_attribute_surface_rollback.sql

BEGIN;

-- ---------------------------------------------------------------------------
-- Preflight. Fail closed if the spine is not the shape LI-1 was designed against.
-- ---------------------------------------------------------------------------
DO $preflight$
BEGIN
  IF to_regclass('public.unified_persons') IS NULL THEN
    RAISE EXCEPTION 'LI-1 preflight: public.unified_persons is missing';
  END IF;
  IF to_regclass('public.prospect_accounts') IS NULL THEN
    RAISE EXCEPTION 'LI-1 preflight: public.prospect_accounts is missing';
  END IF;

  -- The tenant guarantees W5 established must still be in force; these columns
  -- inherit their tenant safety from the row they sit on, so if the row is not
  -- tenant-safe neither are they.
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.unified_persons'::regclass
      AND attname = 'company_id' AND attnotnull
  ) THEN
    RAISE EXCEPTION 'LI-1 preflight: unified_persons.company_id is not NOT NULL — tenant ownership is not guaranteed';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND indexname='uq_unified_persons_id_company'
  ) THEN
    RAISE EXCEPTION 'LI-1 preflight: uq_unified_persons_id_company is missing — the W2/W5 tenant-safe key is absent';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.prospect_accounts'::regclass
      AND attname = 'organization_id' AND attnotnull
  ) THEN
    RAISE EXCEPTION 'LI-1 preflight: prospect_accounts.organization_id is not NOT NULL';
  END IF;
END
$preflight$;

-- ---------------------------------------------------------------------------
-- PERSON attribute surface
-- ---------------------------------------------------------------------------
ALTER TABLE public.unified_persons
  -- Providers frequently supply only a single name string. Splitting it into
  -- given/family names is INFERENCE and is forbidden, so the whole value is
  -- retained here and the split parts are populated only when a source states
  -- them separately.
  ADD COLUMN IF NOT EXISTS full_name             text,
  ADD COLUMN IF NOT EXISTS first_name            text,
  ADD COLUMN IF NOT EXISTS last_name             text,
  -- Title as the source asserted it. No classifier normalises this in LI-1;
  -- see the report's normalisation section.
  ADD COLUMN IF NOT EXISTS job_title             text,
  -- department/seniority are populated ONLY from an explicit provider
  -- assertion. Deriving them from job_title is inference and belongs to a
  -- later, evidence-carrying phase.
  ADD COLUMN IF NOT EXISTS department            text,
  ADD COLUMN IF NOT EXISTS seniority             text,
  -- ISO-3166-1 alpha-2. Country NAMES are ambiguous across providers; the code
  -- is the only form worth storing canonically, and mapping to it is the
  -- ingestion adapter's job.
  ADD COLUMN IF NOT EXISTS country_code          text,
  ADD COLUMN IF NOT EXISTS region                text,
  ADD COLUMN IF NOT EXISTS city                  text,
  -- IANA zone. Included because contact governance (LI-3) needs quiet hours and
  -- send windows, and the platform already stores IANA zones elsewhere.
  ADD COLUMN IF NOT EXISTS timezone              text,
  -- Block-level provenance: which source last wrote these attributes, and when.
  -- Field-level provenance is LI-2; this is not a substitute for it.
  ADD COLUMN IF NOT EXISTS attributes_source     text,
  ADD COLUMN IF NOT EXISTS attributes_updated_at timestamptz;

-- Guards follow the table's existing style (unified_persons_email_not_blank):
-- a column is either absent (NULL) or meaningful. Empty strings are a silent
-- data-quality failure that later scoring would treat as a present value.
DO $person_checks$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='unified_persons_names_not_blank') THEN
    ALTER TABLE public.unified_persons ADD CONSTRAINT unified_persons_names_not_blank CHECK (
      (full_name  IS NULL OR length(btrim(full_name))  > 0) AND
      (first_name IS NULL OR length(btrim(first_name)) > 0) AND
      (last_name  IS NULL OR length(btrim(last_name))  > 0)
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='unified_persons_job_fields_not_blank') THEN
    ALTER TABLE public.unified_persons ADD CONSTRAINT unified_persons_job_fields_not_blank CHECK (
      (job_title  IS NULL OR length(btrim(job_title))  > 0) AND
      (department IS NULL OR length(btrim(department)) > 0)
    );
  END IF;

  -- A bounded vocabulary, because seniority is a routing key for future ICP
  -- and prioritisation. Free text here would make those unimplementable.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='unified_persons_seniority_valid') THEN
    ALTER TABLE public.unified_persons ADD CONSTRAINT unified_persons_seniority_valid CHECK (
      seniority IS NULL OR seniority = ANY (ARRAY[
        'intern','entry','senior','manager','head','director',
        'vp','partner','c_suite','founder','owner','other'])
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='unified_persons_country_code_shape') THEN
    ALTER TABLE public.unified_persons ADD CONSTRAINT unified_persons_country_code_shape CHECK (
      country_code IS NULL OR country_code ~ '^[A-Z]{2}$'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='unified_persons_geo_not_blank') THEN
    ALTER TABLE public.unified_persons ADD CONSTRAINT unified_persons_geo_not_blank CHECK (
      (region   IS NULL OR length(btrim(region))   > 0) AND
      (city     IS NULL OR length(btrim(city))     > 0) AND
      (timezone IS NULL OR length(btrim(timezone)) > 0)
    );
  END IF;

  -- A source without a timestamp (or the reverse) is an unusable provenance
  -- record, so the pair moves together.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='unified_persons_attributes_provenance_coherent') THEN
    ALTER TABLE public.unified_persons ADD CONSTRAINT unified_persons_attributes_provenance_coherent CHECK (
      (attributes_source IS NULL) = (attributes_updated_at IS NULL)
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='unified_persons_attributes_source_not_blank') THEN
    ALTER TABLE public.unified_persons ADD CONSTRAINT unified_persons_attributes_source_not_blank CHECK (
      attributes_source IS NULL OR length(btrim(attributes_source)) > 0
    );
  END IF;
END
$person_checks$;

-- ---------------------------------------------------------------------------
-- ACCOUNT attribute surface
--
-- name, legal_name, website_url and domain_normalized already exist and are
-- untouched. Only firmographics are added. Account IDENTITY rules are
-- unchanged: (organization_id, source, source_reference) and
-- (organization_id, domain_normalized). Nothing below is an identity key —
-- in particular industry and size must never become one.
-- ---------------------------------------------------------------------------
ALTER TABLE public.prospect_accounts
  ADD COLUMN IF NOT EXISTS industry              text,
  -- Exact headcount when a provider asserts one; the band when it only gives a
  -- range. They are different claims, so they are different columns rather than
  -- one column that silently means either.
  ADD COLUMN IF NOT EXISTS employee_count        integer,
  ADD COLUMN IF NOT EXISTS employee_band         text,
  ADD COLUMN IF NOT EXISTS country_code          text,
  ADD COLUMN IF NOT EXISTS region                text,
  ADD COLUMN IF NOT EXISTS city                  text,
  ADD COLUMN IF NOT EXISTS description           text,
  ADD COLUMN IF NOT EXISTS attributes_source     text,
  ADD COLUMN IF NOT EXISTS attributes_updated_at timestamptz;

DO $account_checks$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='prospect_accounts_firmographics_not_blank') THEN
    ALTER TABLE public.prospect_accounts ADD CONSTRAINT prospect_accounts_firmographics_not_blank CHECK (
      (industry    IS NULL OR length(btrim(industry))    > 0) AND
      (region      IS NULL OR length(btrim(region))      > 0) AND
      (city        IS NULL OR length(btrim(city))        > 0) AND
      (description IS NULL OR length(btrim(description)) > 0)
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='prospect_accounts_employee_count_valid') THEN
    ALTER TABLE public.prospect_accounts ADD CONSTRAINT prospect_accounts_employee_count_valid CHECK (
      employee_count IS NULL OR employee_count >= 0
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='prospect_accounts_employee_band_valid') THEN
    ALTER TABLE public.prospect_accounts ADD CONSTRAINT prospect_accounts_employee_band_valid CHECK (
      employee_band IS NULL OR employee_band = ANY (ARRAY[
        '1-10','11-50','51-200','201-500','501-1000','1001-5000','5001-10000','10001+'])
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='prospect_accounts_country_code_shape') THEN
    ALTER TABLE public.prospect_accounts ADD CONSTRAINT prospect_accounts_country_code_shape CHECK (
      country_code IS NULL OR country_code ~ '^[A-Z]{2}$'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='prospect_accounts_attributes_provenance_coherent') THEN
    ALTER TABLE public.prospect_accounts ADD CONSTRAINT prospect_accounts_attributes_provenance_coherent CHECK (
      (attributes_source IS NULL) = (attributes_updated_at IS NULL)
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='prospect_accounts_attributes_source_not_blank') THEN
    ALTER TABLE public.prospect_accounts ADD CONSTRAINT prospect_accounts_attributes_source_not_blank CHECK (
      attributes_source IS NULL OR length(btrim(attributes_source)) > 0
    );
  END IF;
END
$account_checks$;

-- ---------------------------------------------------------------------------
-- Backfill — the ONLY data written by this migration.
--
-- `leads.unified_person_id` is NOT NULL and `leads.name` is the name the person
-- submitted on a form. Copying it to full_name along a proven foreign key is a
-- transcription, not an inference. It is guarded three ways: the person must
-- have exactly ONE distinct non-blank lead name, the target must still be NULL,
-- and it must be the person's own tenant. Where a person's leads disagree, the
-- field is left NULL — a conflict is evidence for the LI-4 review queue, not
-- something to resolve by picking one.
--
-- first_name / last_name are NOT derived from it. Splitting a name is inference
-- and would fabricate structure the source never asserted.
-- ---------------------------------------------------------------------------
WITH unambiguous AS (
  SELECT l.unified_person_id AS person_id,
         l.company_id        AS tenant_id,
         min(btrim(l.name))  AS nm
  FROM public.leads l
  WHERE l.unified_person_id IS NOT NULL
    AND l.name IS NOT NULL
    AND length(btrim(l.name)) > 0
  GROUP BY l.unified_person_id, l.company_id
  HAVING count(DISTINCT btrim(l.name)) = 1
)
UPDATE public.unified_persons p
   SET full_name             = u.nm,
       attributes_source     = 'li1_backfill_lead_name',
       attributes_updated_at = now(),
       updated_at            = now()
  FROM unambiguous u
 WHERE p.id = u.person_id
   AND p.company_id = u.tenant_id     -- never cross a tenant boundary
   AND p.full_name IS NULL;

-- ---------------------------------------------------------------------------
-- Postconditions. Any failure rolls the whole migration back.
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE
  v_person_cols  INT;
  v_account_cols INT;
  v_bad          INT;
BEGIN
  SELECT count(*) INTO v_person_cols FROM pg_attribute
   WHERE attrelid='public.unified_persons'::regclass AND NOT attisdropped
     AND attname = ANY (ARRAY['full_name','first_name','last_name','job_title','department',
       'seniority','country_code','region','city','timezone','attributes_source','attributes_updated_at']);
  IF v_person_cols <> 12 THEN
    RAISE EXCEPTION 'LI-1 postcondition: expected 12 person attribute columns, found %', v_person_cols;
  END IF;

  SELECT count(*) INTO v_account_cols FROM pg_attribute
   WHERE attrelid='public.prospect_accounts'::regclass AND NOT attisdropped
     AND attname = ANY (ARRAY['industry','employee_count','employee_band','country_code',
       'region','city','description','attributes_source','attributes_updated_at']);
  IF v_account_cols <> 9 THEN
    RAISE EXCEPTION 'LI-1 postcondition: expected 9 account attribute columns, found %', v_account_cols;
  END IF;

  -- No backfilled name may disagree with the person's own lead, and none may
  -- have crossed a tenant.
  SELECT count(*) INTO v_bad
    FROM public.unified_persons p
   WHERE p.attributes_source = 'li1_backfill_lead_name'
     AND NOT EXISTS (
       SELECT 1 FROM public.leads l
        WHERE l.unified_person_id = p.id
          AND l.company_id = p.company_id
          AND btrim(l.name) = p.full_name);
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'LI-1 postcondition: % backfilled name(s) not traceable to a same-tenant lead', v_bad;
  END IF;

  RAISE NOTICE 'LI-1: person +12 columns, account +9 columns, backfill verified.';
END
$verify$;

COMMIT;

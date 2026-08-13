-- LI-2 — source records and field-level provenance.
--
-- WHY. LI-1 gave the canonical spine an attribute surface but only block-level
-- provenance: `attributes_source` says "these attributes last came from X",
-- which is enough to invalidate a block and not enough to arbitrate a field.
-- The moment two providers disagree about a job title, one of them has to be
-- discarded — and with nowhere to put the loser, the evidence is destroyed.
-- This migration creates the layer that retains it.
--
--   SOURCE -> source_records (what a provider sent)
--          -> source_assertions (what it claimed, field by field)
--          -> canonical unified_persons / prospect_accounts (what we believe)
--
-- WHAT THIS IS NOT. No provider is activated, no adapter is written, no
-- external call is made, and nothing here enriches, scores, deduplicates or
-- contacts. These tables are empty on arrival and stay empty until LI-7.
--
-- ─── TENANT MODEL (unchanged from W5/LI-1) ─────────────────────────────────
--   organization_id = TENANT (FK -> companies)
--   person_id       -> unified_persons  via composite (person_id, organization_id)
--   account_id      -> prospect_accounts via composite (account_id, organization_id)
-- The same provider record id may exist independently in two tenants; source
-- identity is (organization_id, provider, source_entity_type, source_record_id)
-- and is never global. Email, phone and domain are NOT source identity — they
-- belong to person/account identity resolution, which is untouched.
--
-- ─── DELIBERATE OMISSIONS ──────────────────────────────────────────────────
--   provider is free TEXT, not an enum. Adding Apollo, LinkedIn, RapidAPI, a
--   CRM or Excel must never require a migration; that is the whole point of a
--   provider-neutral layer. Contrast `ingestion_runs.source`, whose CHECK is
--   pinned to six analytics values and which is therefore NOT reused here.
--
--   ingestion_run_id carries NO foreign key. `ingestion_runs` is an analytics
--   ETL tracker (ga4/gsc/ads/crawler) with events_processed and
--   conversions_inserted columns and a closed source vocabulary. Coupling
--   prospect ingestion to it would be the wrong reuse; inventing a second run
--   table now would be a second framework. It is a soft correlation id until
--   LI-7 decides which run mechanism its adapters use. See the report.
--
--   No source-ranking or precedence policy. LI-2 builds the mechanism that
--   makes precedence expressible and stops there — see the canonical update
--   contract in backend/services/prospectIdentity/ingestionBoundary.ts.
--
-- Rollback: supabase/migrations/rollbacks/li2_source_records_rollback.sql
--           (DESTRUCTIVE — it drops the only copy of source evidence)

BEGIN;

-- ---------------------------------------------------------------------------
-- Preflight. These tables hang off the canonical spine; if the spine is not
-- tenant-safe, neither are they.
-- ---------------------------------------------------------------------------
DO $preflight$
BEGIN
  IF to_regclass('public.unified_persons') IS NULL OR to_regclass('public.prospect_accounts') IS NULL THEN
    RAISE EXCEPTION 'LI-2 preflight: the canonical spine is missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname='public' AND indexname='uq_unified_persons_id_company') THEN
    RAISE EXCEPTION 'LI-2 preflight: uq_unified_persons_id_company missing — cannot build a tenant-safe person reference';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname='public' AND indexname='uq_prospect_accounts_id_org') THEN
    RAISE EXCEPTION 'LI-2 preflight: uq_prospect_accounts_id_org missing — cannot build a tenant-safe account reference';
  END IF;

  -- LI-1 must be in place: assertions name canonical attribute columns.
  IF NOT EXISTS (SELECT 1 FROM pg_attribute
                  WHERE attrelid='public.unified_persons'::regclass
                    AND attname='attributes_source' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'LI-2 preflight: LI-1 attribute surface is absent';
  END IF;
END
$preflight$;

-- ---------------------------------------------------------------------------
-- source_records — one row per (tenant, provider, entity type, provider record).
--
-- This is the durable "what the provider sent us" record. It holds the CURRENT
-- raw payload plus observation metadata; the immutable history of what was
-- CLAIMED lives in source_assertions, so re-ingesting an unchanged payload
-- updates counters here and creates nothing there.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.source_records (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- TENANT. Every source record belongs to exactly one tenant, always.
  organization_id     uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  -- Free text on purpose: a new provider must never need a migration.
  provider            text NOT NULL,
  source_entity_type  text NOT NULL,
  -- The provider's OWN identifier for this record. Never an email, phone or
  -- domain — those are person/account identity, resolved elsewhere.
  source_record_id    text NOT NULL,
  -- Canonical links, both nullable: a source record may arrive before identity
  -- is resolved, and parking it unresolved is a supported state.
  person_id           uuid,
  account_id          uuid,
  raw_payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- sha256 of the canonicalised payload. Change detection is a hash comparison,
  -- never a deep object diff, so it is deterministic and cheap.
  payload_hash        text NOT NULL,
  status              text NOT NULL DEFAULT 'active',
  -- When the SOURCE says it observed this, which is not when we ingested it.
  observed_at         timestamptz,
  first_seen_at       timestamptz NOT NULL DEFAULT now(),
  last_seen_at        timestamptz NOT NULL DEFAULT now(),
  ingested_at         timestamptz NOT NULL DEFAULT now(),
  -- How many times this record has been presented to us. Re-ingestion bumps
  -- this instead of creating a duplicate row.
  observation_count   integer NOT NULL DEFAULT 1,
  -- Soft correlation only; see the header note.
  ingestion_run_id    uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT source_records_entity_type_valid
    CHECK (source_entity_type IN ('person', 'account')),
  CONSTRAINT source_records_provider_not_blank
    CHECK (length(btrim(provider)) > 0),
  CONSTRAINT source_records_source_id_not_blank
    CHECK (length(btrim(source_record_id)) > 0),
  CONSTRAINT source_records_payload_object
    CHECK (jsonb_typeof(raw_payload) = 'object'),
  CONSTRAINT source_records_payload_hash_shape
    CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT source_records_status_valid
    CHECK (status IN ('active', 'superseded', 'rejected')),
  CONSTRAINT source_records_observation_count_positive
    CHECK (observation_count >= 1),
  -- An account-shaped record must not name a person; a person-shaped record may
  -- name both itself and its employer.
  CONSTRAINT source_records_entity_coherent
    CHECK (source_entity_type <> 'account' OR person_id IS NULL)
);

-- SOURCE IDENTITY. The idempotency key: one row per provider record per tenant.
-- Tenant A/apollo/person/123 and Tenant B/apollo/person/123 are different rows,
-- deliberately — the same external identity legitimately exists in both.
CREATE UNIQUE INDEX IF NOT EXISTS uq_source_records_tenant_identity
  ON public.source_records (organization_id, provider, source_entity_type, source_record_id);

-- Parent key for the tenant-safe composite foreign key from source_assertions.
CREATE UNIQUE INDEX IF NOT EXISTS uq_source_records_id_org
  ON public.source_records (id, organization_id);

CREATE INDEX IF NOT EXISTS idx_source_records_org_person
  ON public.source_records (organization_id, person_id) WHERE person_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_source_records_org_account
  ON public.source_records (organization_id, account_id) WHERE account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_source_records_org_provider_status
  ON public.source_records (organization_id, provider, status);

-- Tenant-safe canonical references, following the W5 composite pattern. The
-- column-list SET NULL keeps the tenant on a surviving row when a person or
-- account is deleted; evidence outlives the entity it described.
DO $src_fks$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='source_records_person_tenant_fk') THEN
    ALTER TABLE public.source_records
      ADD CONSTRAINT source_records_person_tenant_fk
      FOREIGN KEY (person_id, organization_id)
      REFERENCES public.unified_persons (id, company_id) ON DELETE SET NULL (person_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='source_records_account_tenant_fk') THEN
    ALTER TABLE public.source_records
      ADD CONSTRAINT source_records_account_tenant_fk
      FOREIGN KEY (account_id, organization_id)
      REFERENCES public.prospect_accounts (id, organization_id) ON DELETE SET NULL (account_id);
  END IF;
END
$src_fks$;

-- ---------------------------------------------------------------------------
-- source_assertions — APPEND-ONLY field-level provenance.
--
-- One row per (source record, attribute, distinct value). This is the table
-- that makes competing evidence survivable:
--
--   Apollo   job_title "VP Sales"                  -> one row
--   LinkedIn job_title "VP Enterprise Sales"       -> another row
--   CRM      job_title "Sales Director"            -> a third
--
-- Nothing overwrites anything. A value that later changes at the same source
-- inserts a new row and the previous one is marked superseded, never deleted.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.source_assertions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  source_record_id        uuid NOT NULL,
  entity_type             text NOT NULL,
  person_id               uuid,
  account_id              uuid,
  -- The canonical column this assertion is about, e.g. 'job_title', 'industry'.
  attribute               text NOT NULL,
  -- Both are kept: the raw value is what the provider literally said, the
  -- normalized value is what our own normalisers made of it. Discarding the raw
  -- form would make a normalisation bug unauditable.
  raw_value               text,
  normalized_value        text,
  -- sha256 over the normalized value when present, else the raw value. Drives
  -- the dedupe key below.
  value_hash              text NOT NULL,
  provider                text NOT NULL,
  confidence              numeric,
  observed_at             timestamptz,
  recorded_at             timestamptz NOT NULL DEFAULT now(),
  -- Set when THIS assertion is the one written to the canonical column, with
  -- the deterministic rule that chose it. Together they answer "which value is
  -- canonical, and why".
  applied_to_canonical_at timestamptz,
  applied_reason          text,
  -- Superseded, never deleted.
  superseded_at           timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT source_assertions_entity_type_valid
    CHECK (entity_type IN ('person', 'account')),
  CONSTRAINT source_assertions_attribute_not_blank
    CHECK (length(btrim(attribute)) > 0),
  CONSTRAINT source_assertions_provider_not_blank
    CHECK (length(btrim(provider)) > 0),
  CONSTRAINT source_assertions_value_hash_shape
    CHECK (value_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT source_assertions_confidence_range
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  -- A value that was applied without a reason is an unusable provenance record.
  CONSTRAINT source_assertions_applied_coherent
    CHECK ((applied_to_canonical_at IS NULL) = (applied_reason IS NULL)),
  CONSTRAINT source_assertions_has_a_value
    CHECK (raw_value IS NOT NULL OR normalized_value IS NOT NULL),
  CONSTRAINT source_assertions_entity_coherent
    CHECK (entity_type <> 'account' OR person_id IS NULL)
);

-- IDEMPOTENCY. Re-asserting the same value from the same source record is a
-- no-op (23505); a CHANGED value is a new row. This is what makes repeated
-- ingestion safe without a SELECT-then-INSERT race.
CREATE UNIQUE INDEX IF NOT EXISTS uq_source_assertions_dedupe
  ON public.source_assertions (organization_id, source_record_id, attribute, value_hash);

CREATE INDEX IF NOT EXISTS idx_source_assertions_org_person_attr
  ON public.source_assertions (organization_id, person_id, attribute) WHERE person_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_source_assertions_org_account_attr
  ON public.source_assertions (organization_id, account_id, attribute) WHERE account_id IS NOT NULL;
-- "What is the live evidence for this attribute right now?"
CREATE INDEX IF NOT EXISTS idx_source_assertions_live
  ON public.source_assertions (organization_id, attribute) WHERE superseded_at IS NULL;

DO $assert_fks$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='source_assertions_record_tenant_fk') THEN
    ALTER TABLE public.source_assertions
      ADD CONSTRAINT source_assertions_record_tenant_fk
      FOREIGN KEY (source_record_id, organization_id)
      REFERENCES public.source_records (id, organization_id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='source_assertions_person_tenant_fk') THEN
    ALTER TABLE public.source_assertions
      ADD CONSTRAINT source_assertions_person_tenant_fk
      FOREIGN KEY (person_id, organization_id)
      REFERENCES public.unified_persons (id, company_id) ON DELETE SET NULL (person_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='source_assertions_account_tenant_fk') THEN
    ALTER TABLE public.source_assertions
      ADD CONSTRAINT source_assertions_account_tenant_fk
      FOREIGN KEY (account_id, organization_id)
      REFERENCES public.prospect_accounts (id, organization_id) ON DELETE SET NULL (account_id);
  END IF;
END
$assert_fks$;

-- ---------------------------------------------------------------------------
-- RLS, matching the convention on identity_claims and prospect_accounts: the
-- runtime uses the service-role client and tenant isolation is enforced by the
-- application plus the composite keys above. The policy is parity, not the
-- guarantee — see the report's tenant isolation section.
-- ---------------------------------------------------------------------------
ALTER TABLE public.source_records    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_assertions ENABLE ROW LEVEL SECURITY;

DO $rls$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                  AND tablename='source_records' AND policyname='source_records_service_role') THEN
    CREATE POLICY source_records_service_role ON public.source_records
      FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                  AND tablename='source_assertions' AND policyname='source_assertions_service_role') THEN
    CREATE POLICY source_assertions_service_role ON public.source_assertions
      FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
END
$rls$;

-- ---------------------------------------------------------------------------
-- Postconditions.
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE
  v_fk INT;
  v_uq INT;
BEGIN
  IF to_regclass('public.source_records') IS NULL OR to_regclass('public.source_assertions') IS NULL THEN
    RAISE EXCEPTION 'LI-2 postcondition: a source table is missing';
  END IF;

  -- Five composite tenant-safe foreign keys: 2 on source_records, 3 on source_assertions.
  SELECT count(*) INTO v_fk
    FROM pg_constraint con
    JOIN pg_class s ON s.oid = con.conrelid
   WHERE con.contype='f' AND s.relname IN ('source_records','source_assertions')
     AND array_length(con.conkey, 1) = 2;
  IF v_fk <> 5 THEN
    RAISE EXCEPTION 'LI-2 postcondition: expected 5 composite tenant FKs, found %', v_fk;
  END IF;

  SELECT count(*) INTO v_uq FROM pg_indexes
   WHERE schemaname='public'
     AND indexname IN ('uq_source_records_tenant_identity','uq_source_records_id_org','uq_source_assertions_dedupe');
  IF v_uq <> 3 THEN
    RAISE EXCEPTION 'LI-2 postcondition: expected 3 source unique indexes, found %', v_uq;
  END IF;

  -- LI-2 creates no data.
  IF (SELECT count(*) FROM public.source_records) <> 0
     OR (SELECT count(*) FROM public.source_assertions) <> 0 THEN
    RAISE EXCEPTION 'LI-2 postcondition: source tables must be empty on arrival';
  END IF;

  RAISE NOTICE 'LI-2: source_records + source_assertions created, 5 composite tenant FKs, 0 rows.';
END
$verify$;

COMMIT;

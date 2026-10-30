-- PI / Prospect provenance — the append-only contribution ledger.
--
-- WHAT THIS STORES. One row per SOURCE EVENT that created or later contributed
-- to a canonical prospect (`canonical_leads`). The shared contract is
-- `docs/architecture/PROSPECT-PROVENANCE-CONTRACT.md` and
-- `lib/prospectProvenance/contract.ts`; the only write path is
-- `backend/services/prospectProvenance/contributionWriter.ts`. Column, constraint
-- and index names below are CONTRACT: the writer recognises the two unique
-- violations by name.
--
-- ─── TWO ROLES, ONE ORIGINATOR ────────────────────────────────────────────
-- `originating` = the source whose ingestion CREATED the lead; `contributing` =
-- every later source. A partial unique index allows at most one originating row
-- per lead. A lead that predates provenance is NOT re-originated by its first
-- later contribution — the writer records that as `contributing`.
--
-- ─── APPEND-ONLY BY PRIVILEGE ─────────────────────────────────────────────
-- service_role holds SELECT + INSERT and nothing else; anon, authenticated and
-- PUBLIC hold nothing. No client role can UPDATE or DELETE a contribution. The
-- only mutations a row can ever undergo are the referential actions declared
-- below, which PostgreSQL performs as the table owner.
--
-- ─── TENANCY ──────────────────────────────────────────────────────────────
-- organization_id = companies.id = canonical_leads.company_id. Every reference
-- to another tenant-owned row is a COMPOSITE foreign key on
-- (<pointer>, organization_id), so a contribution can never point at a lead,
-- source record, contact, signal, feed item or message of another tenant: a
-- mismatch is rejected with 23503 by PostgreSQL itself.
--
-- Composite FKs need a unique key on the referenced (id, tenant) pair.
-- `canonical_leads`, `source_records` and `engagement_messages` already carry
-- one; `contacts`, `lead_signals` and `opportunity_feed_items` do not, so this
-- migration adds `(id, organization_id)` unique indexes to them. `id` is already
-- each table's primary key, so the pair is trivially unique and the index
-- cannot fail on existing rows; it adds no restriction on data.
--
-- ─── ON DELETE (rationale: docs/architecture/PROSPECT-PROVENANCE-MIGRATION.md) ─
--   companies            CASCADE  tenant offboarding removes everything it owns.
--   canonical_leads      CASCADE  a contribution has no meaning without its lead,
--                                 and it carries source_url / evidence that can
--                                 be personal data: deleting (erasing) a prospect
--                                 must take its provenance with it. RESTRICT would
--                                 make every prospect with provenance undeletable
--                                 and block tenant/canonical_users cascades.
--   source_records       SET NULL (source_record_id)
--   contacts             SET NULL (contact_id)
--   lead_signals         SET NULL (lead_signal_id)
--   opportunity_feed_items SET NULL (opportunity_feed_item_id)
--   engagement_messages  SET NULL (engagement_message_id)
--     Signal/evidence rows are retention-deleted (feed items hard-deleted, and
--     cascading from lead_signals). The contribution must SURVIVE them: only the
--     pointer is cleared, and the column-list form (PostgreSQL 15+) guarantees
--     organization_id is never nulled. external_ref, platform, source_url,
--     observed_at and evidence keep the history readable after the pointer goes.
--     RESTRICT would turn every contribution into a retention blocker.
--
-- Re-runnable throughout: every object is created IF NOT EXISTS or guarded by
-- name, and the postcondition block re-proves the end state on every replay.

BEGIN;

DO $preflight$
BEGIN
  IF current_setting('server_version_num')::int < 150000 THEN
    RAISE EXCEPTION 'PSC preflight: PostgreSQL 15+ is required for ON DELETE SET NULL (column list), found %',
      current_setting('server_version');
  END IF;

  IF to_regclass('public.companies') IS NULL THEN
    RAISE EXCEPTION 'PSC preflight: public.companies is missing — there is no tenant to own a contribution';
  END IF;

  IF to_regclass('public.canonical_leads') IS NULL THEN
    RAISE EXCEPTION 'PSC preflight: public.canonical_leads is missing — there is no prospect to attribute';
  END IF;

  IF to_regclass('public.source_records') IS NULL THEN
    RAISE EXCEPTION 'PSC preflight: LI-2 source_records is missing — the provenance spine is a prerequisite';
  END IF;

  IF to_regclass('public.contacts') IS NULL
     OR to_regclass('public.lead_signals') IS NULL
     OR to_regclass('public.opportunity_feed_items') IS NULL
     OR to_regclass('public.engagement_messages') IS NULL THEN
    RAISE EXCEPTION 'PSC preflight: a signal/evidence table (contacts, lead_signals, opportunity_feed_items, engagement_messages) is missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_attribute
                  WHERE attrelid = 'public.engagement_messages'::regclass
                    AND attname = 'organization_id' AND NOT attisdropped AND attnotnull) THEN
    RAISE EXCEPTION 'PSC preflight: engagement_messages.organization_id must exist and be NOT NULL (ENG-004, 20261221000000)';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname = 'public' AND indexname = 'idx_canonical_leads_id_company') THEN
    RAISE EXCEPTION 'PSC preflight: idx_canonical_leads_id_company missing — cannot build a tenant-safe lead reference';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname = 'public' AND indexname = 'uq_source_records_id_org') THEN
    RAISE EXCEPTION 'PSC preflight: uq_source_records_id_org missing — cannot build a tenant-safe source record reference';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'engagement_messages_id_org_unique'
                    AND conrelid = 'public.engagement_messages'::regclass) THEN
    RAISE EXCEPTION 'PSC preflight: engagement_messages_id_org_unique missing — cannot build a tenant-safe message reference';
  END IF;

  IF to_regprocedure('auth.role()') IS NULL THEN
    RAISE EXCEPTION 'PSC preflight: auth.role() is missing — the house service_role policy cannot be expressed';
  END IF;
END
$preflight$;

-- ── 1. source_records: additive classification columns ───────────────────
-- Nullable, no default, no backfill. Existing rows are untouched.

ALTER TABLE public.source_records
  ADD COLUMN IF NOT EXISTS source_category text;
ALTER TABLE public.source_records
  ADD COLUMN IF NOT EXISTS platform text;
ALTER TABLE public.source_records
  ADD COLUMN IF NOT EXISTS source_url text;

DO $sr_check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'source_records_source_category_valid'
                    AND conrelid = 'public.source_records'::regclass) THEN
    ALTER TABLE public.source_records
      ADD CONSTRAINT source_records_source_category_valid
      CHECK (source_category IS NULL OR source_category IN (
        'marketpulse', 'social_listening', 'community', 'engagement',
        'inbound_form', 'inbound_webhook', 'manual', 'crm', 'csv',
        'pi_discovery', 'pi_enrichment', 'website'));
  END IF;
END
$sr_check$;

COMMENT ON COLUMN public.source_records.source_category IS
  'Discovery classification (12-value controlled vocabulary, see '
  'lib/prospectProvenance/contract.ts SOURCE_CATEGORIES). Set explicitly by the '
  'ingestion path; never inferred from the display source. NULL = not classified '
  '(rows written before provenance).';
COMMENT ON COLUMN public.source_records.platform IS
  'Originating platform/provider, lowercase (linkedin, reddit, apollo, hubspot, ...).';
COMMENT ON COLUMN public.source_records.source_url IS
  'Where the original evidence lives, when one exists.';

-- ── 2. (id, organization_id) keys for composite tenant FKs ────────────────
-- `id` is the primary key of each table, so these cannot fail on existing rows.

CREATE UNIQUE INDEX IF NOT EXISTS uq_contacts_id_org
  ON public.contacts (id, organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_signals_id_org
  ON public.lead_signals (id, organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_opportunity_feed_items_id_org
  ON public.opportunity_feed_items (id, organization_id);

-- ── 3. The contribution ledger ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.prospect_source_contributions (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id           uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  canonical_lead_id         uuid NOT NULL,

  contribution_role         text NOT NULL,
  source_category           text NOT NULL,
  external_ref              text NOT NULL,

  source_record_id          uuid,
  platform                  text,
  source_url                text,

  contact_id                uuid,
  lead_signal_id            uuid,
  opportunity_feed_item_id  uuid,
  engagement_message_id     uuid,

  ingestion_run_id          text,
  observed_at               timestamptz NOT NULL,

  evidence                  jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_metadata           jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at                timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT psc_contribution_role_valid
    CHECK (contribution_role IN ('originating', 'contributing')),

  CONSTRAINT psc_source_category_valid
    CHECK (source_category IN (
      'marketpulse', 'social_listening', 'community', 'engagement',
      'inbound_form', 'inbound_webhook', 'manual', 'crm', 'csv',
      'pi_discovery', 'pi_enrichment', 'website')),

  CONSTRAINT psc_external_ref_namespaced
    CHECK (external_ref ~ '^[a-z][a-z0-9_]{0,39}:.+'),

  CONSTRAINT psc_evidence_is_object
    CHECK (jsonb_typeof(evidence) = 'object'),
  CONSTRAINT psc_source_metadata_is_object
    CHECK (jsonb_typeof(source_metadata) = 'object'),

  -- Idempotency of a source event per lead. Declared FIRST so that, for a
  -- retried originating event, this (not the originating index) is the
  -- violation PostgreSQL reports; the writer handles either order.
  CONSTRAINT uq_psc_org_lead_external_ref
    UNIQUE (organization_id, canonical_lead_id, external_ref)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_psc_one_originating_per_lead
  ON public.prospect_source_contributions (canonical_lead_id)
  WHERE contribution_role = 'originating';

-- Lookup indexes (contract): tenant+lead+time, tenant+source record, tenant+category+time.
CREATE INDEX IF NOT EXISTS idx_psc_org_lead_observed
  ON public.prospect_source_contributions (organization_id, canonical_lead_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_psc_org_source_record
  ON public.prospect_source_contributions (organization_id, source_record_id)
  WHERE source_record_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_psc_org_category_observed
  ON public.prospect_source_contributions (organization_id, source_category, observed_at DESC);

-- Referential-action support: a parent delete (e.g. a 10k-row retention batch
-- of feed items) looks referencing rows up by pointer; without these each
-- deleted parent would scan this table.
CREATE INDEX IF NOT EXISTS idx_psc_contact
  ON public.prospect_source_contributions (contact_id)
  WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_psc_lead_signal
  ON public.prospect_source_contributions (lead_signal_id)
  WHERE lead_signal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_psc_opportunity_feed_item
  ON public.prospect_source_contributions (opportunity_feed_item_id)
  WHERE opportunity_feed_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_psc_engagement_message
  ON public.prospect_source_contributions (engagement_message_id)
  WHERE engagement_message_id IS NOT NULL;

DO $psc_fks$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'psc_lead_tenant_fk') THEN
    ALTER TABLE public.prospect_source_contributions
      ADD CONSTRAINT psc_lead_tenant_fk
      FOREIGN KEY (canonical_lead_id, organization_id)
      REFERENCES public.canonical_leads (id, company_id) ON DELETE CASCADE;
  END IF;

  -- The column list is NOT optional on the SET NULL keys below: a bare
  -- `ON DELETE SET NULL` on a composite FK nulls EVERY referencing column,
  -- including organization_id (NOT NULL), and the parent delete would fail.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'psc_source_record_tenant_fk') THEN
    ALTER TABLE public.prospect_source_contributions
      ADD CONSTRAINT psc_source_record_tenant_fk
      FOREIGN KEY (source_record_id, organization_id)
      REFERENCES public.source_records (id, organization_id)
      ON DELETE SET NULL (source_record_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'psc_contact_tenant_fk') THEN
    ALTER TABLE public.prospect_source_contributions
      ADD CONSTRAINT psc_contact_tenant_fk
      FOREIGN KEY (contact_id, organization_id)
      REFERENCES public.contacts (id, organization_id)
      ON DELETE SET NULL (contact_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'psc_lead_signal_tenant_fk') THEN
    ALTER TABLE public.prospect_source_contributions
      ADD CONSTRAINT psc_lead_signal_tenant_fk
      FOREIGN KEY (lead_signal_id, organization_id)
      REFERENCES public.lead_signals (id, organization_id)
      ON DELETE SET NULL (lead_signal_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'psc_opportunity_feed_item_tenant_fk') THEN
    ALTER TABLE public.prospect_source_contributions
      ADD CONSTRAINT psc_opportunity_feed_item_tenant_fk
      FOREIGN KEY (opportunity_feed_item_id, organization_id)
      REFERENCES public.opportunity_feed_items (id, organization_id)
      ON DELETE SET NULL (opportunity_feed_item_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'psc_engagement_message_tenant_fk') THEN
    ALTER TABLE public.prospect_source_contributions
      ADD CONSTRAINT psc_engagement_message_tenant_fk
      FOREIGN KEY (engagement_message_id, organization_id)
      REFERENCES public.engagement_messages (id, organization_id)
      ON DELETE SET NULL (engagement_message_id);
  END IF;
END
$psc_fks$;

-- ── 4. Exposure: RLS, one service_role policy, SELECT + INSERT only ───────

ALTER TABLE public.prospect_source_contributions ENABLE ROW LEVEL SECURITY;

DO $psc_rls$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'prospect_source_contributions'
       AND policyname = 'prospect_source_contributions_service_role'
       AND roles::text[] <> ARRAY['service_role']
  ) THEN
    DROP POLICY prospect_source_contributions_service_role
      ON public.prospect_source_contributions;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'prospect_source_contributions'
       AND policyname = 'prospect_source_contributions_service_role'
  ) THEN
    CREATE POLICY prospect_source_contributions_service_role
      ON public.prospect_source_contributions
      FOR ALL
      TO service_role
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END
$psc_rls$;

REVOKE ALL ON TABLE public.prospect_source_contributions
  FROM PUBLIC, anon, authenticated, authenticator, service_role;
GRANT SELECT, INSERT ON TABLE public.prospect_source_contributions TO service_role;

COMMENT ON TABLE public.prospect_source_contributions IS
  'PI provenance: one row per source event that originated or later contributed '
  'to a canonical prospect. Append-only (service_role holds SELECT+INSERT only). '
  'Exactly one originating row per lead (uq_psc_one_originating_per_lead); a '
  'source event is recorded once per lead (uq_psc_org_lead_external_ref). '
  'Writer: backend/services/prospectProvenance/contributionWriter.ts.';
COMMENT ON COLUMN public.prospect_source_contributions.contribution_role IS
  'originating = this source''s ingestion CREATED the lead; contributing = any '
  'later source. A lead created before provenance is never re-originated.';
COMMENT ON COLUMN public.prospect_source_contributions.source_category IS
  'Discovery classification (12-value vocabulary). Not the display source '
  '(lead_intelligence.source / CanonicalLeadSource).';
COMMENT ON COLUMN public.prospect_source_contributions.external_ref IS
  'Namespaced <provider>:<id>; the idempotency key of a source event per lead.';
COMMENT ON COLUMN public.prospect_source_contributions.observed_at IS
  'When the SOURCE observed it (posted_at, detected_at, form submit time) — not '
  'ingestion time; created_at is our clock.';
COMMENT ON COLUMN public.prospect_source_contributions.opportunity_feed_item_id IS
  'Optional pointer. Feed items are retention hard-deleted: ON DELETE SET NULL '
  '(opportunity_feed_item_id) clears the pointer and keeps the contribution.';
COMMENT ON COLUMN public.prospect_source_contributions.ingestion_run_id IS
  'Same type and meaning as source_records.ingestion_run_id (text).';

-- ── 5. Postconditions ─────────────────────────────────────────────────────

DO $verify$
DECLARE
  v_n           INT;
  v_rls         BOOLEAN;
  v_force       BOOLEAN;
  v_pol_roles   text[];
  v_priv        text[];
  v_leaked      text[];
  v_def         text;
  r             record;
BEGIN
  IF to_regclass('public.prospect_source_contributions') IS NULL THEN
    RAISE EXCEPTION 'PSC postcondition: the table is missing';
  END IF;

  -- source_records additions
  SELECT count(*) INTO v_n FROM pg_attribute
   WHERE attrelid = 'public.source_records'::regclass AND NOT attisdropped
     AND attname IN ('source_category', 'platform', 'source_url') AND NOT attnotnull;
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'PSC postcondition: source_records must carry nullable source_category, platform, source_url (found %)', v_n;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'source_records_source_category_valid' AND contype = 'c'
                    AND conrelid = 'public.source_records'::regclass) THEN
    RAISE EXCEPTION 'PSC postcondition: source_records_source_category_valid is missing';
  END IF;

  -- (id, organization_id) keys
  FOR r IN SELECT * FROM (VALUES
      ('contacts', 'uq_contacts_id_org'),
      ('lead_signals', 'uq_lead_signals_id_org'),
      ('opportunity_feed_items', 'uq_opportunity_feed_items_id_org')) AS t(tbl, idx)
  LOOP
    SELECT pg_get_indexdef(i.indexrelid) INTO v_def
      FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
     WHERE c.relname = r.idx AND i.indrelid = ('public.' || r.tbl)::regclass
       AND i.indisunique AND i.indisvalid AND i.indpred IS NULL;
    IF v_def IS NULL OR v_def NOT LIKE '%(id, organization_id)' THEN
      RAISE EXCEPTION 'PSC postcondition: % must be a valid, non-partial UNIQUE index on %(id, organization_id), found %',
        r.idx, r.tbl, coalesce(v_def, '<absent>');
    END IF;
  END LOOP;

  -- Foreign keys: 6 composite tenant FKs with the designed delete actions.
  SELECT count(*) INTO v_n
    FROM pg_constraint
   WHERE conrelid = 'public.prospect_source_contributions'::regclass
     AND contype = 'f' AND array_length(conkey, 1) = 2;
  IF v_n <> 6 THEN
    RAISE EXCEPTION 'PSC postcondition: expected 6 composite tenant FKs, found %', v_n;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'psc_lead_tenant_fk' AND confdeltype = 'c'
                    AND conrelid = 'public.prospect_source_contributions'::regclass) THEN
    RAISE EXCEPTION 'PSC postcondition: psc_lead_tenant_fk must be ON DELETE CASCADE';
  END IF;

  FOR r IN SELECT * FROM (VALUES
      ('psc_source_record_tenant_fk', 'source_record_id'),
      ('psc_contact_tenant_fk', 'contact_id'),
      ('psc_lead_signal_tenant_fk', 'lead_signal_id'),
      ('psc_opportunity_feed_item_tenant_fk', 'opportunity_feed_item_id'),
      ('psc_engagement_message_tenant_fk', 'engagement_message_id')) AS t(con, col)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c
       WHERE c.conname = r.con AND c.confdeltype = 'n'
         AND c.conrelid = 'public.prospect_source_contributions'::regclass
         AND c.confdelsetcols IS NOT NULL
         AND array_length(c.confdelsetcols, 1) = 1
         AND (SELECT attname FROM pg_attribute
               WHERE attrelid = c.conrelid AND attnum = c.confdelsetcols[1]) = r.col) THEN
      RAISE EXCEPTION 'PSC postcondition: % must be ON DELETE SET NULL (%) — the tenant column must never be nulled', r.con, r.col;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.prospect_source_contributions'::regclass
                    AND contype = 'f' AND confrelid = 'public.companies'::regclass
                    AND confdeltype = 'c') THEN
    RAISE EXCEPTION 'PSC postcondition: organization_id must reference companies ON DELETE CASCADE';
  END IF;

  -- Named unique constraint / partial unique index (contract names).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'uq_psc_org_lead_external_ref' AND contype = 'u'
                    AND conrelid = 'public.prospect_source_contributions'::regclass
                    AND pg_get_constraintdef(oid) = 'UNIQUE (organization_id, canonical_lead_id, external_ref)') THEN
    RAISE EXCEPTION 'PSC postcondition: uq_psc_org_lead_external_ref must be UNIQUE (organization_id, canonical_lead_id, external_ref)';
  END IF;

  SELECT pg_get_indexdef(i.indexrelid) INTO v_def
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
   WHERE c.relname = 'uq_psc_one_originating_per_lead'
     AND i.indrelid = 'public.prospect_source_contributions'::regclass
     AND i.indisunique AND i.indisvalid;
  IF v_def IS NULL
     OR v_def NOT LIKE '%(canonical_lead_id) WHERE (contribution_role = ''originating''::text)' THEN
    RAISE EXCEPTION 'PSC postcondition: uq_psc_one_originating_per_lead must be UNIQUE (canonical_lead_id) WHERE contribution_role = originating, found %',
      coalesce(v_def, '<absent>');
  END IF;

  SELECT count(*) INTO v_n FROM pg_indexes
   WHERE schemaname = 'public' AND tablename = 'prospect_source_contributions'
     AND indexname IN ('idx_psc_org_lead_observed', 'idx_psc_org_source_record',
                       'idx_psc_org_category_observed', 'idx_psc_contact',
                       'idx_psc_lead_signal', 'idx_psc_opportunity_feed_item',
                       'idx_psc_engagement_message');
  IF v_n <> 7 THEN
    RAISE EXCEPTION 'PSC postcondition: expected 7 named lookup indexes, found %', v_n;
  END IF;

  SELECT count(*) INTO v_n FROM pg_constraint
   WHERE conrelid = 'public.prospect_source_contributions'::regclass AND contype = 'c'
     AND conname IN ('psc_contribution_role_valid', 'psc_source_category_valid',
                     'psc_external_ref_namespaced', 'psc_evidence_is_object',
                     'psc_source_metadata_is_object');
  IF v_n <> 5 THEN
    RAISE EXCEPTION 'PSC postcondition: expected 5 named CHECK constraints, found %', v_n;
  END IF;

  -- RLS and privileges.
  SELECT c.relrowsecurity, c.relforcerowsecurity INTO v_rls, v_force
    FROM pg_class c WHERE c.oid = 'public.prospect_source_contributions'::regclass;
  IF NOT v_rls THEN
    RAISE EXCEPTION 'PSC postcondition: row level security must be ENABLED';
  END IF;
  IF v_force THEN
    RAISE EXCEPTION 'PSC postcondition: row level security must NOT be FORCED — FORCE would subject the owner and break referential actions and owner-connection suites';
  END IF;

  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'prospect_source_contributions';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'PSC postcondition: expected exactly 1 policy, found %', v_n;
  END IF;
  SELECT roles::text[] INTO v_pol_roles FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'prospect_source_contributions'
     AND policyname = 'prospect_source_contributions_service_role';
  IF v_pol_roles IS DISTINCT FROM ARRAY['service_role'] THEN
    RAISE EXCEPTION 'PSC postcondition: the policy must apply to exactly {service_role}, found %', v_pol_roles;
  END IF;

  SELECT array_agg(DISTINCT a.privilege_type ORDER BY a.privilege_type) INTO v_priv
    FROM pg_class c
    CROSS JOIN LATERAL aclexplode(c.relacl) a
    JOIN pg_roles r2 ON r2.oid = a.grantee
   WHERE c.oid = 'public.prospect_source_contributions'::regclass
     AND r2.rolname = 'service_role';
  IF v_priv IS DISTINCT FROM ARRAY['INSERT', 'SELECT'] THEN
    RAISE EXCEPTION 'PSC postcondition: service_role must hold exactly {INSERT,SELECT} (append-only), found %',
      coalesce(v_priv::text, '{}');
  END IF;

  SELECT array_agg(DISTINCT r2.rolname || ':' || a.privilege_type) INTO v_leaked
    FROM pg_class c
    CROSS JOIN LATERAL aclexplode(c.relacl) a
    JOIN pg_roles r2 ON r2.oid = a.grantee
   WHERE c.oid = 'public.prospect_source_contributions'::regclass
     AND r2.rolname IN ('anon', 'authenticated', 'authenticator');
  IF v_leaked IS NOT NULL THEN
    RAISE EXCEPTION 'PSC postcondition: anon, authenticated and authenticator must hold nothing, found %', v_leaked;
  END IF;

  SELECT count(*) INTO v_n
    FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
   WHERE c.oid = 'public.prospect_source_contributions'::regclass AND a.grantee = 0;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'PSC postcondition: PUBLIC must hold no privilege, found % grant(s)', v_n;
  END IF;

  RAISE NOTICE 'PSC: prospect_source_contributions verified — 6 composite tenant FKs (lead CASCADE, 5 pointer SET NULL (col)), contract unique constraint + partial originating index, 7 lookup indexes, 5 CHECKs; RLS enabled, not forced, 1 service_role policy; service_role SELECT+INSERT only; source_records +3 nullable columns; 3 (id, organization_id) keys.';
END
$verify$;

COMMIT;

-- P0 CONTACT GOVERNANCE — minimal fixture for the isolated PostgREST proof.
--
-- Applied to a DISPOSABLE service container, after scripts/ci/schema-bootstrap.sql
-- (which creates anon / authenticated / service_role / authenticator and the
-- schemas and extensions the governed schema expects). It is NEVER applied to
-- production, and it references no production host, credential or project.
--
-- ─── WHAT THIS PROVES, AND WHY IT NEEDS A REAL DATABASE ─────────────────────
-- That `public.read_at(public.contact_governance_records)` is SELECTABLE as a
-- PostgREST computed field through the repository's own `@supabase/supabase-js`
-- client, that it returns one transaction timestamp per REQUEST, that two
-- requests return two different ones, and that only `service_role` may call it.
-- None of that can be shown with a mock: a mock would be asserting the shape of
-- my own assumption about PostgREST.
--
-- ─── WHY NOT REPLAY THE REAL MIGRATIONS ─────────────────────────────────────
-- The real table migration (20261003000000) guards on `companies`,
-- `unified_persons` and `source_records` existing and then adds composite
-- tenant foreign keys into the latter two. Replaying it would mean standing up
-- three more tables to prove something about a function that reads no row at
-- all. The table below is the real COLUMN LIST, the real CHECK constraints and
-- the real lookup indexes, which are the only parts that can affect either the
-- queries under test or the computed field.
--
-- ─── FIXTURE DIFFERENCES FROM PRODUCTION, STATED RATHER THAN DISCOVERED ─────
--   1. NO composite FKs to `unified_persons (id, company_id)` or
--      `source_records (id, organization_id)`. Those tables are absent. A
--      foreign key constrains what may be WRITTEN; it cannot change what a
--      SELECT returns or whether a computed field is selectable.
--   2. NO `contact_governance_has_anchor` widening from 20261027000000
--      (DEFECT-008), which admits an anchorless row only when it is revoked.
--      The original, NARROWER constraint is used here. Every fixture row below
--      carries an anchor, so the difference cannot be reached.
--   3. `source`, `target_raw`, `evidence`, `revoked_reason`, `created_at` and
--      `updated_at` exist with their real types but carry no provenance: this
--      is not an audit fixture.
--   4. `service_role` is granted SELECT and INSERT EXPLICITLY below. On hosted
--      Supabase `ALTER DEFAULT PRIVILEGES` already grants it ALL on a new table
--      in `public`, and a bare PostgreSQL container has no such default. The
--      grant here reproduces the hosted state; it does not widen it. Nothing is
--      granted to `anon` or `authenticated`, which is also the hosted state for
--      this table (migration 20261111000002 revoked their class-wide grants).
--   5. RLS is enabled, as in production, and `service_role` has BYPASSRLS, as
--      in production. Tenant isolation on these reads therefore comes from the
--      application's `.eq('organization_id', …)` predicate and NOT from RLS,
--      which is exactly why the tenant test is written at the QUERY level.

BEGIN;

-- The FK target for `organization_id`. Kept, because it is one column and it
-- means a fixture row cannot name a tenant that does not exist.
CREATE TABLE IF NOT EXISTS public.companies (
  id uuid PRIMARY KEY
);
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

-- The real column list and the real CHECK constraints, copied from
-- 20261003000000_li3_contact_governance.sql and 20261126000000_pg001_contact_purpose_scope.sql.
CREATE TABLE IF NOT EXISTS public.contact_governance_records (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  person_id           uuid,
  target_normalized   text,
  target_raw          text,
  channel             text NOT NULL,
  governance_type     text NOT NULL,
  source              text NOT NULL,
  source_record_id    uuid,
  evidence            jsonb NOT NULL DEFAULT '{}'::jsonb,
  effective_from      timestamptz NOT NULL DEFAULT now(),
  effective_until     timestamptz,
  revoked_at          timestamptz,
  revoked_reason      text,
  purpose_scope       text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT contact_governance_type_valid CHECK (governance_type IN (
    'dnc_permanent', 'dnc_channel', 'unsubscribe', 'consent_withdrawn',
    'invalid_contact', 'bounce_hard', 'complaint', 'deferred', 'campaign_exclusion')),
  CONSTRAINT contact_governance_channel_not_blank
    CHECK (length(btrim(channel)) > 0),
  CONSTRAINT contact_governance_has_anchor
    CHECK (person_id IS NOT NULL OR (target_normalized IS NOT NULL AND length(btrim(target_normalized)) > 0)),
  CONSTRAINT contact_governance_permanent_is_all_channels
    CHECK (governance_type <> 'dnc_permanent' OR channel = '*'),
  CONSTRAINT contact_governance_channel_dnc_is_specific
    CHECK (governance_type <> 'dnc_channel' OR channel <> '*'),
  CONSTRAINT contact_governance_until_only_deferred
    CHECK (effective_until IS NULL OR governance_type = 'deferred'),
  CONSTRAINT contact_governance_period_ordered
    CHECK (effective_until IS NULL OR effective_until > effective_from),
  CONSTRAINT contact_governance_revocation_coherent
    CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL)),
  CONSTRAINT contact_governance_source_not_blank
    CHECK (length(btrim(source)) > 0),
  CONSTRAINT contact_governance_evidence_object
    CHECK (jsonb_typeof(evidence) = 'object'),
  CONSTRAINT contact_governance_target_not_blank
    CHECK (target_normalized IS NULL OR length(btrim(target_normalized)) > 0),
  CONSTRAINT contact_governance_purpose_scope_valid
    CHECK (purpose_scope IS NULL OR purpose_scope IN ('outreach', 'account')),
  CONSTRAINT contact_governance_purpose_scope_scopeable_type
    CHECK (purpose_scope IS NULL
           OR governance_type IN ('unsubscribe', 'consent_withdrawn', 'complaint'))
);

ALTER TABLE public.contact_governance_records ENABLE ROW LEVEL SECURITY;

-- The two anchor-specific PARTIAL indexes. They are the reason the repository
-- issues two narrow reads instead of one `or()`, so the query-shape evidence
-- needs them present to mean anything.
CREATE INDEX IF NOT EXISTS idx_contact_governance_org_person
  ON public.contact_governance_records (organization_id, person_id)
  WHERE person_id IS NOT NULL AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_contact_governance_org_target
  ON public.contact_governance_records (organization_id, target_normalized)
  WHERE target_normalized IS NOT NULL AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_contact_governance_org_channel_type
  ON public.contact_governance_records (organization_id, channel, governance_type)
  WHERE revoked_at IS NULL;

-- The identity key, as rebuilt by 20261126000000 once `purpose_scope` existed.
-- Present so that a fixture insert cannot do something production would refuse.
CREATE UNIQUE INDEX IF NOT EXISTS uq_contact_governance_identity
  ON public.contact_governance_records (
    organization_id,
    channel,
    governance_type,
    coalesce(person_id::text, target_normalized),
    coalesce(purpose_scope, 'all'))
  WHERE revoked_at IS NULL;

-- Fixture difference 4. Reproduces the hosted default-privilege state for
-- service_role; nothing for anon or authenticated.
--
-- DELETE and TRUNCATE are deliberately NOT granted. The suite seeds and reads;
-- it never needs to remove a governance row, and a read-path proof is not a
-- reason to hand the service role the ability to erase a compliance record. The
-- whole table is dropped by the job's teardown step instead.
GRANT SELECT, INSERT ON public.companies TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.contact_governance_records TO service_role;

-- ─── A PROBE ROLE, so the FUNCTION privilege can be tested in isolation ─────
-- `anon` and `authenticated` cannot read this table at all, so a request they
-- make fails on the TABLE and never reaches the computed field — which proves
-- they cannot call it, but proves nothing about the function's own ACL.
--
-- `pi_cg_probe` has SELECT on the table and NO EXECUTE on the function. It
-- exists only so that one real PostgREST request can show `select=id`
-- succeeding and `select=id,read_at` being refused for the same role, which
-- isolates the EXECUTE grant from the table grant. It is a CI-only role and is
-- created by this fixture, never by a migration.
DO $probe$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pi_cg_probe') THEN
    CREATE ROLE pi_cg_probe NOLOGIN NOINHERIT;
  END IF;
END
$probe$;

GRANT pi_cg_probe TO authenticator;
GRANT USAGE ON SCHEMA public TO pi_cg_probe;
GRANT SELECT ON public.contact_governance_records TO pi_cg_probe;
-- No EXECUTE on public.read_at, and the migration under test revokes PUBLIC, so
-- there is no path by which this role inherits it.

COMMIT;

-- W1 — Canonical prospect / identity foundation (ADDITIVE ONLY).
--
-- Creates the two entities the canonical spine was missing, and the one link
-- between them. Creates NOTHING that resolves, merges, enriches or contacts
-- anyone: this migration is storage and constraints only.
--
-- ─── WHAT ALREADY EXISTED (audited before authoring) ───────────────────────
-- `unified_persons` is already the canonical person spine and is already
-- correct in the ways that matter:
--   • company_id uuid NOT NULL → companies(id) ON DELETE CASCADE
--   • UNIQUE (company_id, primary_email) WHERE primary_email IS NOT NULL
--   • UNIQUE (company_id, primary_phone) WHERE primary_phone IS NOT NULL AND length >= 10
--   • provenance columns source_of_truth / source_priority
--   • 12 tables already carry an FK to it (leads, contacts, canonical_leads,
--     canonical_users, engagement_threads, visitor_sessions, users, …)
-- `backend/services/identityResolutionService.ts` already resolves against it
-- and every lookup is already `.eq('company_id', …)` — tenant scoping is not
-- being introduced here, it is being preserved.
--
-- So W1 does NOT rebuild the spine. It adds what is genuinely absent:
--   1. prospect_accounts — the external company being pursued
--   2. identity_claims   — the durable, explainable record of WHY a person is
--                          believed to be a given person
--   3. unified_persons.account_id — the person → account link
--
-- ─── WHY identity_claims EXISTS AT ALL ─────────────────────────────────────
-- The existing resolver already computes the answer: it returns `matchedBy`
-- ('email' | 'phone' | 'external_keys' | 'created'). But that answer is only
-- LOGGED. Once the log rotates, nothing in the system can explain why two
-- records were treated as one person. `identity_claims` makes that reasoning
-- durable and queryable. It is the difference between a merge you can audit
-- and a merge you have to trust.
--
-- ─── TENANT SCOPE IS THE POINT, NOT A DETAIL ───────────────────────────────
-- Every uniqueness constraint below leads with organization_id. The same
-- human, the same email, the same phone, the same LinkedIn profile and the
-- same company domain may exist independently in two tenants, and MUST — a
-- globally-unique person or account would be a shared mutable object that two
-- tenants enrich, score and suppress against each other. Cross-tenant identity
-- is not a feature this platform offers.
--
-- Note for future readers: `engagement_identity_candidates` predates this work
-- and is UNIQUE (platform, external_id) with NO tenant column. That is a
-- pre-existing platform-global identity fragment. W1 does not extend it, does
-- not depend on it, and deliberately does not follow its shape.
--
-- ─── NORMALIZATION IS STORED, NOT RE-DERIVED ───────────────────────────────
-- `normalized_value` is written by the application using the repository's
-- EXISTING normalizers — `normalizeCompanyDomain` (lib/shared/domain/
-- companyDomain.ts) for domains, and the email/phone normalizers already used
-- by identityResolutionService. The database stores the result and enforces
-- uniqueness on it; it does not implement a second, divergent normalization.
-- A CHECK enforces the one invariant that matters: normalized_value is never
-- blank and never differs in case from itself.
--
-- Scope: 2 new tables, 1 new nullable column, indexes, RLS. Alters no existing
-- column, drops nothing, migrates no data, touches no legacy lead model.
-- Idempotent.
--
-- Rollback: supabase/migrations/rollbacks/w1_prospect_identity_foundation_rollback.sql

-- ── 1. prospect_accounts ────────────────────────────────────────────────────
--
-- The external company being researched or pursued. NOT `companies` — that is
-- the Omnivyra tenant, and conflating the two would make every prospect a
-- tenant and collapse the isolation model entirely.

CREATE TABLE IF NOT EXISTS public.prospect_accounts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Owning tenant. uuid throughout, matching companies(id).
  organization_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

  -- Canonical identity: registrable domain, produced by normalizeCompanyDomain.
  -- Nullable because an account can legitimately be known by name before a
  -- domain is discovered (a MarketPulse mention, a manual entry).
  domain_normalized  text,
  -- The domain exactly as received, kept for provenance/debugging.
  domain_raw         text,

  name               text,
  legal_name         text,
  website_url        text,

  -- Provenance. Deliberately free-form TEXT, not an enum: the source model must
  -- accept connectors that do not exist yet, and an enum would require a
  -- migration for each one.
  source             text NOT NULL DEFAULT 'manual',
  source_reference   text,

  -- Lifecycle. `merged` retains the row and points at the survivor rather than
  -- deleting, so a merge never destroys history.
  status             text NOT NULL DEFAULT 'active',
  merged_into_id     uuid REFERENCES public.prospect_accounts(id) ON DELETE SET NULL,

  confidence         numeric,
  metadata           jsonb NOT NULL DEFAULT '{}'::jsonb,

  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_verified_at   timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT prospect_accounts_status_valid
    CHECK (status IN ('active', 'merged', 'suppressed', 'archived')),
  CONSTRAINT prospect_accounts_confidence_range
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  CONSTRAINT prospect_accounts_metadata_object
    CHECK (jsonb_typeof(metadata) = 'object'),
  -- Normalized domain must already be normalized when it arrives.
  CONSTRAINT prospect_accounts_domain_normalized_shape
    CHECK (domain_normalized IS NULL
           OR (length(btrim(domain_normalized)) > 0
               AND domain_normalized = lower(domain_normalized)
               AND domain_normalized NOT LIKE '%/%'
               AND domain_normalized NOT LIKE '%@%')),
  CONSTRAINT prospect_accounts_source_not_blank
    CHECK (length(btrim(source)) > 0),
  -- A merged row must say what it merged into; an unmerged row must not.
  CONSTRAINT prospect_accounts_merge_coherent
    CHECK ((status = 'merged') = (merged_into_id IS NOT NULL)),
  CONSTRAINT prospect_accounts_no_self_merge
    CHECK (merged_into_id IS NULL OR merged_into_id <> id)
);

-- TENANT-SCOPED account identity. Two tenants may each hold their own account
-- row for the same domain; within one tenant an active domain appears once.
-- Partial on status so a merged/archived row never blocks a live one.
CREATE UNIQUE INDEX IF NOT EXISTS uq_prospect_accounts_org_domain_active
  ON public.prospect_accounts (organization_id, domain_normalized)
  WHERE domain_normalized IS NOT NULL AND status = 'active';

-- Tenant-scoped listing / lookup.
CREATE INDEX IF NOT EXISTS idx_prospect_accounts_org_status
  ON public.prospect_accounts (organization_id, status);

-- Merge-chain traversal.
CREATE INDEX IF NOT EXISTS idx_prospect_accounts_merged_into
  ON public.prospect_accounts (merged_into_id)
  WHERE merged_into_id IS NOT NULL;

-- ── 2. unified_persons.account_id ───────────────────────────────────────────
--
-- Person → PRIMARY account. Nullable: a person may be known before their
-- company is (that is exactly the "Company Required" readiness case).
--
-- Deliberately one primary account, not many-to-many. A consultant, agency
-- contact or executive with several businesses is a real scenario, but it is
-- an ASSOCIATION, not a primary employer, and modelling it as many-to-many now
-- would add a join table with no consumer. This choice is additive and
-- non-destructive: a future `prospect_account_members` table can carry the
-- many-to-many without altering or dropping this column, because nothing here
-- asserts that the primary account is the ONLY account.
--
-- ON DELETE SET NULL: deleting an account must never cascade into people.

ALTER TABLE public.unified_persons
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.prospect_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_unified_persons_account
  ON public.unified_persons (account_id)
  WHERE account_id IS NOT NULL;

-- Roster query: "people at this account, in this tenant".
CREATE INDEX IF NOT EXISTS idx_unified_persons_company_account
  ON public.unified_persons (company_id, account_id)
  WHERE account_id IS NOT NULL;

-- ── 3. identity_claims ──────────────────────────────────────────────────────
--
-- One asserted identifier for one canonical person, with the evidence for it.
-- Append-mostly: claims are added and superseded, and `revoked_at` retires a
-- claim without erasing that it was once believed.

CREATE TABLE IF NOT EXISTS public.identity_claims (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id   uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

  -- Subject. Nullable so an unresolved claim can be recorded by the shadow
  -- resolver without asserting a person — observing is not deciding.
  person_id         uuid REFERENCES public.unified_persons(id) ON DELETE CASCADE,
  account_id        uuid REFERENCES public.prospect_accounts(id) ON DELETE SET NULL,

  -- WHAT kind of identifier. Closed set: an open vocabulary here would make
  -- uniqueness meaningless.
  claim_type        text NOT NULL,
  -- WHICH platform issued it. NULL for provider-agnostic types (email, phone,
  -- domain); set for external identities. The repository already separates
  -- platform from identity type — `contacts` is
  -- (organization_id, platform, platform_user_id) — and this follows it.
  platform          text,

  -- The value after the application's normalizer ran.
  normalized_value  text NOT NULL,
  -- The value exactly as received.
  raw_value         text,

  -- WHY we believe it. `source` is free-form for the same reason as on
  -- prospect_accounts; `evidence` carries the structured justification —
  -- for the shadow resolver, the resolver's own matchedBy verdict.
  source            text NOT NULL DEFAULT 'manual',
  source_reference  text,
  evidence          jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence        numeric,

  -- Verification is a separate axis from confidence: a high-confidence claim
  -- may still be unverified, and an unverified claim is not a false one.
  verification_state text NOT NULL DEFAULT 'unverified',
  verified_at       timestamptz,

  observed_at       timestamptz NOT NULL DEFAULT now(),
  recorded_at       timestamptz NOT NULL DEFAULT now(),
  revoked_at        timestamptz,
  revoked_reason    text,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT identity_claims_type_valid
    CHECK (claim_type IN ('email', 'phone', 'domain', 'external_profile', 'external_id')),
  CONSTRAINT identity_claims_platform_rule
    -- Provider-agnostic types carry no platform; external types must name one.
    CHECK (
      (claim_type IN ('email', 'phone', 'domain') AND platform IS NULL)
      OR (claim_type IN ('external_profile', 'external_id') AND platform IS NOT NULL AND length(btrim(platform)) > 0)
    ),
  CONSTRAINT identity_claims_value_not_blank
    CHECK (length(btrim(normalized_value)) > 0),
  -- Normalized means normalized. Catches a caller that stored the raw value.
  CONSTRAINT identity_claims_value_is_normalized
    CHECK (normalized_value = lower(normalized_value)),
  CONSTRAINT identity_claims_confidence_range
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  CONSTRAINT identity_claims_evidence_object
    CHECK (jsonb_typeof(evidence) = 'object'),
  CONSTRAINT identity_claims_verification_valid
    CHECK (verification_state IN ('unverified', 'verified', 'rejected')),
  CONSTRAINT identity_claims_verified_coherent
    CHECK ((verification_state = 'verified') = (verified_at IS NOT NULL)),
  CONSTRAINT identity_claims_source_not_blank
    CHECK (length(btrim(source)) > 0)
);

-- ── THE UNIQUENESS RULE ─────────────────────────────────────────────────────
--
-- An identity claim is unique on:
--     (organization_id, claim_type, platform, normalized_value)
--
-- among ACTIVE (non-revoked) claims.
--
-- NULLS NOT DISTINCT is essential and deliberate. `platform` is NULL for
-- email/phone/domain; under the default NULLS DISTINCT two identical email
-- claims would BOTH be permitted, because NULL <> NULL — silently defeating
-- the constraint for exactly the three most common claim types. PostgreSQL 15+
-- is required for this; the server is 17.6.
--
-- Tenant-scoped by construction: the same email may be claimed independently
-- in another tenant.
CREATE UNIQUE INDEX IF NOT EXISTS uq_identity_claims_tenant_identity
  ON public.identity_claims (organization_id, claim_type, platform, normalized_value)
  NULLS NOT DISTINCT
  WHERE revoked_at IS NULL;

-- Resolution hot path: "does this tenant already know this identifier?"
CREATE INDEX IF NOT EXISTS idx_identity_claims_lookup
  ON public.identity_claims (organization_id, claim_type, normalized_value)
  WHERE revoked_at IS NULL;

-- "Everything we believe about this person."
CREATE INDEX IF NOT EXISTS idx_identity_claims_person
  ON public.identity_claims (person_id)
  WHERE person_id IS NOT NULL;

-- Unresolved observations awaiting review.
CREATE INDEX IF NOT EXISTS idx_identity_claims_unresolved
  ON public.identity_claims (organization_id, recorded_at DESC)
  WHERE person_id IS NULL AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_identity_claims_account
  ON public.identity_claims (account_id)
  WHERE account_id IS NOT NULL;

-- ── 4. updated_at triggers (existing repository helper) ─────────────────────

DROP TRIGGER IF EXISTS trg_prospect_accounts_updated_at ON public.prospect_accounts;
CREATE TRIGGER trg_prospect_accounts_updated_at
  BEFORE UPDATE ON public.prospect_accounts
  FOR EACH ROW EXECUTE FUNCTION omnivyra_touch_updated_at();

DROP TRIGGER IF EXISTS trg_identity_claims_updated_at ON public.identity_claims;
CREATE TRIGGER trg_identity_claims_updated_at
  BEFORE UPDATE ON public.identity_claims
  FOR EACH ROW EXECUTE FUNCTION omnivyra_touch_updated_at();

-- ── 5. RLS — matching the existing repository convention ────────────────────
--
-- The backend uses a service-role client that bypasses RLS, so this is NOT the
-- tenant boundary; application guards are. It is enabled for parity with every
-- other table and to keep any future anon/authenticated path closed by default.

ALTER TABLE public.prospect_accounts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY prospect_accounts_service_role ON public.prospect_accounts
    FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.identity_claims ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY identity_claims_service_role ON public.identity_claims
    FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON TABLE public.prospect_accounts IS
  'External company being researched/pursued, owned by a tenant. NOT companies (the tenant). Tenant-scoped: (organization_id, domain_normalized) is unique among active rows only, so the same domain may exist independently in two tenants.';

COMMENT ON TABLE public.identity_claims IS
  'Durable, explainable identity assertions for unified_persons. Unique on (organization_id, claim_type, platform, normalized_value) NULLS NOT DISTINCT among non-revoked claims — tenant-scoped by construction. person_id is nullable so the shadow resolver can record an observation without asserting a person.';

COMMENT ON COLUMN public.unified_persons.account_id IS
  'Primary prospect account. Nullable — a person may be known before their company is. One primary account by design; a future membership table can add many-to-many additively without altering this column.';

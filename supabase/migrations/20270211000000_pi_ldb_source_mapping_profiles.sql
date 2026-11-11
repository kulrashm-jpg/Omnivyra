-- PI-LDB-1 — tenant AND platform mapping profiles for AI-assisted semantic attribute mapping.
--
-- ─── VERSION AND APPLIED STATUS ─────────────────────────────────────────────
-- Renumbered from 20270201000000 (virality-83 ruling, 2026-11-11, reserved in
-- registry commit 996b6552d). The 20270201* version was NEVER applied anywhere:
-- C6 (production catalogue, owner-approved) found none of its objects, and no
-- apply record exists. Content was edited in the same change, before any first
-- apply: platform/tenant scope added; users FKs dropped (GOV-H).
--
-- ─── WHY THIS EXISTS ────────────────────────────────────────────────────────
-- Every external ingestion path must pass through one common semantic mapping
-- and validation layer, and a tenant who has once told us that their
-- `Designation` column means `job_title` must never be asked again. That
-- decision has to live somewhere durable and tenant-scoped, which is this pair
-- of tables.
--
-- A profile is keyed on the SHAPE of the incoming file, not its name: a
-- `schema_fingerprint` over the normalised header set. The same vendor export
-- next month matches the same profile; a file with a changed header set does
-- not, and is re-proposed instead of silently reusing decisions that were made
-- about different columns.
--
-- ─── VERSIONED, NEVER EDITED IN PLACE ───────────────────────────────────────
-- Profiles supersede rather than mutate, so the mapping that was in force for
-- any past import remains recoverable. `source_assertions.mapping_profile_id`
-- (PI-LDB-2) points at the exact version that decided a field, which is what
-- makes a historical mapping auditable rather than merely current.
--
-- ─── ACTORS: NO FOREIGN KEY INTO users (GOV-H) ──────────────────────────────
-- `created_by` and `approved_by` are immutable actor attribution. Per the
-- repository's actor-field rule they carry NO foreign key into users (an
-- `ON DELETE SET NULL` FK rewrites history when a user is deleted, and an
-- append-only guard would then make the user undeletable). They are nullable
-- and WRITER-VALIDATED: the single writer, mappingProfileStore, is called only
-- with a verified principal who is an active member of the tenant (tenant
-- profiles) or a Super Admin (platform profiles). Integrity comes from profile
-- VERSIONING, not from freezing rows.
--
-- ─── SCOPE: TENANT OR PLATFORM ─────────────────────────────────────────────
-- `scope = 'tenant'`: one organisation's mapping for its own files
--   (organization_id NOT NULL; approved by a member).
-- `scope = 'platform'`: a data VENDOR's mapping (e.g. Apollo's response shape),
--   shared by every tenant (organization_id NULL; approved by Super Admin only,
--   never writable by a client role). Coordinator ruling, 2026-11-11.
-- Entries carry the same scope as their profile, enforced by a composite FK on
-- (profile_id, scope), so an entry can never attach to the other scope's
-- profile; tenant entries additionally keep the composite tenant FK.
--
-- Creates no data. No existing table, column, index, constraint or policy is
-- modified.

BEGIN;

-- ---------------------------------------------------------------------------
-- source_mapping_profiles — one approved mapping decision set per file shape.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.source_mapping_profiles (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 'tenant' (organization_id set) or 'platform' (organization_id NULL).
  scope               text NOT NULL DEFAULT 'tenant',
  organization_id     uuid NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  -- Free text, matching `source_records.provider`: the ingestion contract
  -- declares `source` as a free-text provider key on purpose, and constraining
  -- it here would make this table refuse a source the contract accepts. The
  -- `ingestion_runs` CHECK list is a DIFFERENT, narrower vocabulary and is
  -- deliberately not reused.
  source              text NOT NULL,
  -- sha256 over the order-insensitive set of normalised headers. Computed by
  -- `fingerprintSchema` in the mapping engine; the database only stores it.
  schema_fingerprint  text NOT NULL,
  -- Monotonic per (organization, source, fingerprint). A new approval
  -- supersedes the previous version rather than editing it.
  version             integer NOT NULL,
  -- `active`    — in force for this file shape.
  -- `superseded`— replaced by a later version.
  -- `drifted`   — the tenant's source changed shape; kept for audit, not reused.
  status              text NOT NULL DEFAULT 'active',
  -- How many headers the file carried. Lets a reader size a profile without
  -- loading its entries.
  header_count        integer NOT NULL,
  -- The header list EXACTLY as the source wrote it, in file order.
  --
  -- Stored rather than derived, because entries are not guaranteed to cover
  -- every header: a tenant may approve four of nine columns and leave the rest
  -- undecided, and a profile reconstructed from entries alone would then claim
  -- the file had four columns. That is the input to the drift report, so the
  -- error would surface as "5 columns appeared" on the very next import of an
  -- unchanged file. No default: every insert must say what the shape was.
  headers             jsonb NOT NULL,
  -- GOV-H actor: no FK into users; writer-validated (see header).
  created_by          uuid NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  superseded_at       timestamptz,

  CONSTRAINT source_mapping_profiles_scope_valid
    CHECK (scope IN ('tenant', 'platform')),
  -- A tenant profile names its tenant; a platform profile names none.
  CONSTRAINT source_mapping_profiles_scope_org_coherent
    CHECK ((scope = 'platform') = (organization_id IS NULL)),
  CONSTRAINT source_mapping_profiles_source_not_blank
    CHECK (length(btrim(source)) > 0),
  CONSTRAINT source_mapping_profiles_fingerprint_shape
    CHECK (schema_fingerprint ~ '^[a-f0-9]{64}$'),
  CONSTRAINT source_mapping_profiles_version_positive
    CHECK (version >= 1),
  CONSTRAINT source_mapping_profiles_header_count_positive
    CHECK (header_count >= 1),
  CONSTRAINT source_mapping_profiles_headers_is_array
    CHECK (jsonb_typeof(headers) = 'array'),
  -- The two must agree. Written from one array by one function today, so this
  -- guards the next writer rather than the current one — which is the writer
  -- worth guarding against.
  -- CASE-guarded, not a bare `jsonb_array_length(headers) = header_count`.
  -- Postgres does not guarantee the evaluation ORDER of CHECK constraints (nor
  -- of the operands of AND), so on a non-array `headers` the bare form reaches
  -- jsonb_array_length first and raises 22023 invalid_parameter_value instead
  -- of a constraint violation. The row is refused either way, but the caller
  -- gets a parameter error for what is a constraint problem. CASE *does* have
  -- defined order, so this yields 23514 for a wrong type and a wrong count
  -- alike, whichever constraint the planner happens to evaluate first.
  CONSTRAINT source_mapping_profiles_header_count_matches
    CHECK (CASE WHEN jsonb_typeof(headers) = 'array'
                THEN jsonb_array_length(headers) = header_count
                ELSE false END),
  CONSTRAINT source_mapping_profiles_status_valid
    CHECK (status IN ('active', 'superseded', 'drifted')),
  -- A non-active profile without a supersession timestamp is an unusable audit
  -- record, and an active one with a timestamp contradicts itself.
  CONSTRAINT source_mapping_profiles_status_coherent
    CHECK ((status = 'active') = (superseded_at IS NULL))
);

-- At most ONE active profile per file shape. This is the constraint that makes
-- "reuse the tenant's approved mapping" a deterministic lookup rather than a
-- choice between candidates.
-- Partial per scope: organization_id is NULL on platform rows, and NULLs are
-- distinct in a unique index, so one index over (organization_id, ...) would
-- allow any number of active platform profiles for one shape.
CREATE UNIQUE INDEX IF NOT EXISTS uq_source_mapping_profiles_active
  ON public.source_mapping_profiles (organization_id, source, schema_fingerprint)
  WHERE status = 'active' AND scope = 'tenant';

CREATE UNIQUE INDEX IF NOT EXISTS uq_source_mapping_profiles_version
  ON public.source_mapping_profiles (organization_id, source, schema_fingerprint, version)
  WHERE scope = 'tenant';

CREATE UNIQUE INDEX IF NOT EXISTS uq_source_mapping_profiles_platform_active
  ON public.source_mapping_profiles (source, schema_fingerprint)
  WHERE status = 'active' AND scope = 'platform';

CREATE UNIQUE INDEX IF NOT EXISTS uq_source_mapping_profiles_platform_version
  ON public.source_mapping_profiles (source, schema_fingerprint, version)
  WHERE scope = 'platform';

-- Parent key for the scope-safe composite foreign key on entries.
CREATE UNIQUE INDEX IF NOT EXISTS uq_source_mapping_profiles_id_scope
  ON public.source_mapping_profiles (id, scope);

-- Parent key for the tenant-safe composite foreign keys below and in PI-LDB-2.
-- A child referencing only `id` could point at another tenant's profile.
CREATE UNIQUE INDEX IF NOT EXISTS uq_source_mapping_profiles_id_org
  ON public.source_mapping_profiles (id, organization_id);

CREATE INDEX IF NOT EXISTS idx_source_mapping_profiles_org_source
  ON public.source_mapping_profiles (organization_id, source, created_at DESC);

COMMENT ON TABLE public.source_mapping_profiles IS
  'Versioned semantic mapping decisions keyed on the header-set fingerprint of a source: tenant-scoped (a tenant''s own files) or platform-scoped (a data vendor''s shape, Super Admin approved). Superseded, never edited.';

-- ---------------------------------------------------------------------------
-- source_mapping_profile_entries — the per-column decisions inside a profile.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.source_mapping_profile_entries (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The profile's scope, repeated so the composite FK can bind it.
  scope                   text NOT NULL DEFAULT 'tenant',
  organization_id         uuid NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  profile_id              uuid NOT NULL,
  -- The header EXACTLY as the source wrote it. Preserved because a mapping
  -- report that cannot quote the tenant's own column name is unreadable.
  source_field            text NOT NULL,
  -- The same header after `normaliseHeader`. Matching happens on this; display
  -- happens on the column above.
  source_field_normalized text NOT NULL,
  -- A `CanonicalFieldKey` from the engine's registry, e.g. 'jobTitle'. NULL
  -- only when the decision is `ignored`. NOT constrained to a value list: the
  -- registry is application-owned and a CHECK here would need a migration every
  -- time a canonical field is added, while the write boundary already refuses
  -- any column outside its allowlist.
  target_field            text,
  -- `approved` — write this column here.
  -- `rejected` — the tenant said this target is wrong for this column.
  -- `ignored`  — the tenant said drop this column entirely.
  decision                text NOT NULL,
  -- How the decision was reached. `tenant_confirmed` and `tenant_override` are
  -- a human's answer; `high_confidence_suggestion` is the engine's, accepted in
  -- bulk. Keeping them distinct is what lets a later audit separate "a person
  -- decided this" from "nobody looked".
  mapping_method          text NOT NULL,
  -- A `TransformationName` from the engine's closed set, or NULL for identity.
  transformation          text,
  -- The deterministic score at the time of approval. Advisory and historical:
  -- recomputing it later against changed weights would not reproduce it, which
  -- is precisely why it is stored rather than derived.
  score                   numeric,
  -- The evidence list the scorer produced, verbatim.
  evidence                jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- GOV-H actor: no FK into users; writer-validated (see header).
  approved_by             uuid NULL,
  approved_at             timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT smpe_scope_valid
    CHECK (scope IN ('tenant', 'platform')),
  CONSTRAINT smpe_scope_org_coherent
    CHECK ((scope = 'platform') = (organization_id IS NULL)),
  CONSTRAINT smpe_source_field_not_blank
    CHECK (length(btrim(source_field)) > 0),
  CONSTRAINT smpe_normalized_not_blank
    CHECK (length(btrim(source_field_normalized)) > 0),
  CONSTRAINT smpe_decision_valid
    CHECK (decision IN ('approved', 'rejected', 'ignored')),
  CONSTRAINT smpe_mapping_method_valid
    CHECK (mapping_method IN (
      'approved_profile_match',
      'high_confidence_suggestion',
      'tenant_confirmed',
      'tenant_override',
      -- Step E (2026-11-11, registry-owner GO): a Super Admin's approval of a
      -- PLATFORM (vendor) profile entry. Never a tenant method (the store
      -- refuses it for tenant profiles).
      'platform_approved'
    )),
  -- An approval or a rejection is ABOUT a target; an ignore is the absence of
  -- one. Without this, `ignored` rows could carry a target and be mistaken for
  -- approvals by any reader that only checks `target_field IS NOT NULL`.
  CONSTRAINT smpe_target_matches_decision
    CHECK (
      (decision IN ('approved', 'rejected') AND target_field IS NOT NULL
         AND length(btrim(target_field)) > 0)
      OR (decision = 'ignored' AND target_field IS NULL)
    ),
  CONSTRAINT smpe_score_range
    CHECK (score IS NULL OR (score >= 0 AND score <= 1)),
  CONSTRAINT smpe_evidence_is_array
    CHECK (jsonb_typeof(evidence) = 'array'),
  -- A human decision with no timestamp cannot be audited.
  CONSTRAINT smpe_tenant_decision_has_provenance
    CHECK (
      mapping_method NOT IN ('tenant_confirmed', 'tenant_override', 'platform_approved')
      OR approved_at IS NOT NULL
    )
);

-- One approved destination per column, per profile. The rule that makes a
-- profile lookup unambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS uq_smpe_approved_per_field
  ON public.source_mapping_profile_entries (profile_id, source_field_normalized)
  WHERE decision = 'approved';

CREATE UNIQUE INDEX IF NOT EXISTS uq_smpe_ignored_per_field
  ON public.source_mapping_profile_entries (profile_id, source_field_normalized)
  WHERE decision = 'ignored';

-- A tenant may reject SEVERAL targets for one column ("not job title, not
-- description"), so rejections are unique per target rather than per field.
CREATE UNIQUE INDEX IF NOT EXISTS uq_smpe_rejected_per_target
  ON public.source_mapping_profile_entries (profile_id, source_field_normalized, target_field)
  WHERE decision = 'rejected';

CREATE INDEX IF NOT EXISTS idx_smpe_profile
  ON public.source_mapping_profile_entries (organization_id, profile_id);

COMMENT ON TABLE public.source_mapping_profile_entries IS
  'Per-column mapping decisions within a source_mapping_profiles version: approved, rejected or ignored, with the actor and the evidence that produced each.';

-- ---------------------------------------------------------------------------
-- Tenant-safe composite foreign key: an entry cannot reference another
-- tenant's profile, because the tenant is part of the key.
-- ---------------------------------------------------------------------------
DO $fk$
BEGIN
  -- Tenant rows: the tenant is part of the key. (MATCH SIMPLE skips this check
  -- when organization_id is NULL, i.e. on platform rows - which is why the
  -- scope FK below exists.)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'smpe_profile_tenant_fk') THEN
    ALTER TABLE public.source_mapping_profile_entries
      ADD CONSTRAINT smpe_profile_tenant_fk
      FOREIGN KEY (profile_id, organization_id)
      REFERENCES public.source_mapping_profiles (id, organization_id)
      ON DELETE CASCADE;
  END IF;
  -- Every row: the entry's scope must be its profile's scope. Both columns are
  -- NOT NULL, so this is always checked, and a platform entry cannot attach to
  -- a tenant profile (or the reverse).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'smpe_profile_scope_fk') THEN
    ALTER TABLE public.source_mapping_profile_entries
      ADD CONSTRAINT smpe_profile_scope_fk
      FOREIGN KEY (profile_id, scope)
      REFERENCES public.source_mapping_profiles (id, scope)
      ON DELETE CASCADE;
  END IF;
END
$fk$;

-- ---------------------------------------------------------------------------
-- RLS — parity with the LI-2 source tables: service_role only. The application
-- boundary plus the composite keys above are the actual guarantee.
-- ---------------------------------------------------------------------------
ALTER TABLE public.source_mapping_profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_mapping_profile_entries ENABLE ROW LEVEL SECURITY;

DO $rls$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                  AND tablename = 'source_mapping_profiles'
                  AND policyname = 'source_mapping_profiles_service_role') THEN
    CREATE POLICY source_mapping_profiles_service_role ON public.source_mapping_profiles
      FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                  AND tablename = 'source_mapping_profile_entries'
                  AND policyname = 'smpe_service_role') THEN
    CREATE POLICY smpe_service_role ON public.source_mapping_profile_entries
      FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
END
$rls$;

-- ---------------------------------------------------------------------------
-- Postconditions. Asserted on named identity, not on counts that cannot fail.
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE
  v_idx INT;
  v_fk  INT;
BEGIN
  IF to_regclass('public.source_mapping_profiles') IS NULL
     OR to_regclass('public.source_mapping_profile_entries') IS NULL THEN
    RAISE EXCEPTION 'PI-LDB-1 postcondition: a mapping profile table is missing';
  END IF;

  -- Named explicitly: a bare count would pass if the wrong index existed.
  SELECT count(*) INTO v_idx FROM pg_indexes
   WHERE schemaname = 'public'
     AND indexname IN (
       'uq_source_mapping_profiles_active',
       'uq_source_mapping_profiles_version',
       'uq_source_mapping_profiles_platform_active',
       'uq_source_mapping_profiles_platform_version',
       'uq_source_mapping_profiles_id_org',
       'uq_source_mapping_profiles_id_scope',
       'uq_smpe_approved_per_field',
       'uq_smpe_ignored_per_field',
       'uq_smpe_rejected_per_target');
  IF v_idx <> 9 THEN
    RAISE EXCEPTION 'PI-LDB-1 postcondition: expected 9 named unique indexes, found %', v_idx;
  END IF;

  SELECT count(*) INTO v_fk
    FROM pg_constraint
   WHERE conrelid = 'public.source_mapping_profile_entries'::regclass
     AND conname IN ('smpe_profile_tenant_fk', 'smpe_profile_scope_fk')
     AND contype = 'f'
     AND array_length(conkey, 1) = 2;
  IF v_fk <> 2 THEN
    RAISE EXCEPTION 'PI-LDB-1 postcondition: the composite tenant FK or scope FK on profile entries is missing';
  END IF;

  -- GOV-H: the actor columns carry NO foreign key (a later edit re-adding one
  -- trips here).
  IF EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
              WHERE c.contype = 'f' AND a.attname IN ('created_by', 'approved_by')
                AND c.conrelid IN ('public.source_mapping_profiles'::regclass, 'public.source_mapping_profile_entries'::regclass)) THEN
    RAISE EXCEPTION 'PI-LDB-1 postcondition: an actor column (created_by/approved_by) carries a foreign key (GOV-H)';
  END IF;

  IF (SELECT count(*) FROM public.source_mapping_profiles) <> 0
     OR (SELECT count(*) FROM public.source_mapping_profile_entries) <> 0 THEN
    RAISE EXCEPTION 'PI-LDB-1 postcondition: mapping profile tables must be empty on arrival';
  END IF;

  RAISE NOTICE 'PI-LDB-1: source_mapping_profiles + entries created (tenant + platform scope), 9 unique indexes, tenant + scope FKs, no actor FK, 0 rows.';
END
$verify$;

-- ---------------------------------------------------------------------------
-- PRIVILEGES. Explicit, in both directions, following 20270107000000:330-332.
--
-- Neither was issued before, and RLS is not a substitute for either. RLS filters
-- rows for a role that HAS table privileges; it does not grant them, and
-- BYPASSRLS bypasses policies rather than GRANTs. The two consequences were
-- opposite and both wrong:
--
--   * Supabase grants ALL on every new public table to `authenticated` by
--     default — 20261026000000 revokes only `anon` (and TRUNCATE) via ALTER
--     DEFAULT PRIVILEGES — so these two tenant tables would arrive in production
--     client-writable, with the policy as the only barrier. That is the exposure
--     class 20270111000002 was written to close, reopened by arriving later than
--     it. The class-wide hardening migrations enumerate their tables and so
--     cannot reach a table created after them.
--   * In any environment WITHOUT those platform defaults — the CI real-schema
--     harness, whose baseline is dumped --no-privileges — nothing is granted to
--     anyone and the feature is dead on arrival.
--
-- The CI harness connects as superuser and carries no ACLs, so no test can catch
-- either. Hence the assertions above.
-- ---------------------------------------------------------------------------
-- ── THE GRANTEE LIST (corrected, Prompt 2B) ────────────────────────────────
-- Five grantees, not three. This migration cited 20270107000000:330-332 as its
-- pattern and then named two fewer roles than that pattern does, which left the
-- citation true about the idea and false about the statement.
--
-- `service_role` is the one that mattered, and it is the APPLICATION's role.
-- Supabase's hosted default privileges grant it ALL on every new public table,
-- and nothing in this repository ever revokes that default - so a three-grantee
-- REVOKE left the surplus untouched and the GRANT below became a no-op. Measured
-- in a sandbox reproducing those defaults, `service_role` held UPDATE, DELETE
-- and TRUNCATE on arrival.
--
-- TRUNCATE is why this is not cosmetic. It is a STATEMENT-level operation, so it
-- does not fire FOR EACH ROW triggers: an append-only table's guard triggers
-- never run, and the whole table can be emptied in one statement by the role the
-- application runs as, without dropping a trigger or the table.
--
-- `authenticator` holds nothing in any measured state (NOINHERIT, and not a
-- grantee of the hosted defaults). It is named for completeness and audit
-- symmetry with the cited pattern, not because it is an exposure.
--
-- Safe in every environment: REVOKE of a privilege not held is a no-op, and the
-- CI bootstrap creates all four roles idempotently, so an absent role cannot be
-- reached here. The postcondition below now PROVES the result instead of
-- assuming it.
REVOKE ALL ON TABLE public.source_mapping_profiles
  FROM PUBLIC, anon, authenticated, authenticator, service_role;
REVOKE ALL ON TABLE public.source_mapping_profile_entries
  FROM PUBLIC, anon, authenticated, authenticator, service_role;

-- The minimum the store actually needs: it reads the active profile, inserts a
-- new version, and UPDATEs status to supersede the previous one. It never
-- deletes — superseding is an UPDATE, which is what makes the history auditable.
GRANT SELECT, INSERT, UPDATE ON TABLE public.source_mapping_profiles TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.source_mapping_profile_entries TO service_role;

-- Asserted AFTER the grants, in its own block. These assertions were first
-- written into the verify block above, which runs BEFORE these statements — so
-- they read the pre-grant state and the migration raised on its own correct
-- work. Only executing it found that; every static read of the file looked fine.
DO $privs$
BEGIN
  IF has_table_privilege('service_role', 'public.source_mapping_profiles', 'INSERT') IS NOT TRUE
     OR has_table_privilege('service_role', 'public.source_mapping_profile_entries', 'INSERT') IS NOT TRUE THEN
    RAISE EXCEPTION 'PI-LDB-1 postcondition: service_role cannot write the mapping profile tables';
  END IF;
  IF has_table_privilege('authenticated', 'public.source_mapping_profiles', 'SELECT') IS NOT FALSE THEN
    RAISE EXCEPTION 'PI-LDB-1 postcondition: authenticated still holds SELECT on source_mapping_profiles';
  END IF;
  -- THE SURPLUS, asserted rather than assumed (Prompt 2B). The grant above is
  -- SELECT, INSERT, UPDATE; DELETE and TRUNCATE are not in it, so holding
  -- either means the hosted default privileges survived the REVOKE. Checked on
  -- both tables, because the exposure arrives per-table from the defaults and
  -- not from anything this file does.
  IF has_table_privilege('service_role', 'public.source_mapping_profiles', 'DELETE') IS NOT FALSE
     OR has_table_privilege('service_role', 'public.source_mapping_profiles', 'TRUNCATE') IS NOT FALSE
     OR has_table_privilege('service_role', 'public.source_mapping_profile_entries', 'DELETE') IS NOT FALSE
     OR has_table_privilege('service_role', 'public.source_mapping_profile_entries', 'TRUNCATE') IS NOT FALSE THEN
    RAISE EXCEPTION 'PI-LDB-1 postcondition: service_role still holds DELETE or TRUNCATE on a mapping profile table';
  END IF;
  RAISE NOTICE 'PI-LDB-1 privileges: service_role write granted, client roles revoked, surplus DELETE/TRUNCATE removed.';
END
$privs$;

COMMIT;

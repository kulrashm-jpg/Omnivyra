-- PI / Prospect provenance — privacy redaction of contributions on person
-- erasure, and per-tenant MarketPulse signal observations.
--
-- Owner decisions (2026-10-30, binding):
--   (6) MarketPulse observations are tenant-safe: a shared global signal is
--       never overwritten by another tenant's processing.
--   (8) Person erasure redacts personal source URLs and evidence from the
--       contribution ledger while keeping an auditable redaction/tombstone
--       record. Existing retention and audit policy is respected; nothing is
--       deleted.
--
-- ─── A. marketpulse_signal_observations ───────────────────────────────────
-- `marketpulse_signals` is GLOBAL (no tenant column; unique on duplicate_key).
-- The application now INSERTs the shared row and, on 23505, reads it back and
-- never writes to it again (marketPulseIntelligenceService.ts,
-- persistSharedSignalWithoutOverwrite). What each tenant actually observed —
-- its own title/summary/evidence URL/time and the run and finding that
-- produced it — lives HERE, one row per (tenant, signal, observation).
--
--   company_id         companies.id, ON DELETE CASCADE (tenant offboarding).
--                      The MarketPulse family keys its tenant as company_id.
--   signal_id          marketpulse_signals.id, ON DELETE CASCADE — the same
--                      action marketpulse_company_signal_relevance and
--                      marketpulse_signal_impacts already declare.
--   observation_key    namespaced `<kind>:<id>`; the idempotency key per
--                      (company_id, signal_id). The writer uses
--                      `finding:<market_pulse_findings.id>`, else
--                      `run:<market_pulse_runs.id>`, else
--                      `content:<sha256 of title|summary|observed_at>`.
--   run_id/finding_id  opaque correlation references to this tenant's legacy
--                      engine rows. Deliberately NOT foreign keys: those tables
--                      carry no (id, company_id) key, and adding one to them is
--                      outside this migration; the only writer passes the run
--                      and finding of the same tenant it is processing.
--
-- Append-only by privilege: service_role holds SELECT + INSERT.
--
-- ─── B. prospect_source_contribution_redactions + the redaction function ──
-- `prospect_source_contributions` (20270107000000) is append-only: service_role
-- holds SELECT + INSERT and nothing else. That stays true. Redaction is the ONE
-- sanctioned mutation, and it happens only inside
-- `public.pi_redact_prospect_source_contributions(...)`, a SECURITY DEFINER
-- function (search_path pinned to '', every object schema-qualified) that, in a
-- single statement — therefore a single transaction:
--
--   1. refuses (42501) if any requested lead belongs to ANOTHER tenant;
--   2. locks the tenant's not-yet-redacted contributions of those leads;
--   3. per contribution, inserts a TOMBSTONE carrying the reason, the requester,
--      the NAMES of the fields it redacted and a sha256 of the redacted values
--      — never the values;
--   4. nulls `source_url` and replaces `evidence` and `source_metadata` with a
--      marker object `{"redacted": true, "redaction_id": <tombstone id>}`.
--
-- The contribution row is NEVER deleted: its identity, tenant, lead, role,
-- category, external_ref, platform, typed pointers, observed_at and created_at
-- survive, so the provenance chain remains readable. Every key of `evidence` and
-- `source_metadata` is removed (an allow-list of "non-personal" keys would have
-- to be proven per ingestion path; the whole object is the conservative unit).
--
-- Idempotent: a contribution is tombstoned at most once
-- (uq_pscr_contribution); a repeated call reports it as already redacted and
-- changes nothing.
--
-- Tombstones are append-only BY PRIVILEGE TOO: service_role holds SELECT only;
-- the function (running as the owner) is the only writer.
--
--   organization_id  companies.id ON DELETE CASCADE (tenant offboarding — the
--                    same rule as the ledger itself).
--   contribution_id  composite FK (contribution_id, organization_id) →
--                    prospect_source_contributions(id, organization_id)
--                    ON DELETE SET NULL (contribution_id): if the contribution
--                    is later removed by its own CASCADE (lead or tenant
--                    delete), the AUDIT RECORD SURVIVES with its hash and reason.
--   canonical_lead_id  plain uuid, recorded for audit; not an FK for the same
--                    reason (the record must outlive the lead).
--
-- (id, organization_id) on prospect_source_contributions: `id` is the primary
-- key, so the new unique index cannot fail on existing rows and restricts
-- nothing; it only makes the tenant-safe composite reference expressible.
--
-- Grants: service_role gets EXECUTE on the function and SELECT on the
-- tombstones. anon, authenticated, authenticator and PUBLIC get nothing on any
-- object here. service_role's privilege on prospect_source_contributions is
-- re-proved below to be still exactly {INSERT, SELECT}.
--
-- Re-runnable throughout: IF NOT EXISTS / guarded by name / CREATE OR REPLACE,
-- and the postcondition block re-proves the end state on every replay.

BEGIN;

DO $preflight$
BEGIN
  IF current_setting('server_version_num')::int < 150000 THEN
    RAISE EXCEPTION 'PRV preflight: PostgreSQL 15+ is required for ON DELETE SET NULL (column list), found %',
      current_setting('server_version');
  END IF;
  IF to_regclass('public.companies') IS NULL THEN
    RAISE EXCEPTION 'PRV preflight: public.companies is missing';
  END IF;
  IF to_regclass('public.canonical_leads') IS NULL THEN
    RAISE EXCEPTION 'PRV preflight: public.canonical_leads is missing';
  END IF;
  IF to_regclass('public.prospect_source_contributions') IS NULL THEN
    RAISE EXCEPTION 'PRV preflight: prospect_source_contributions is missing — apply 20270107000000 first';
  END IF;
  IF to_regclass('public.marketpulse_signals') IS NULL THEN
    RAISE EXCEPTION 'PRV preflight: public.marketpulse_signals is missing — there is no global signal to observe';
  END IF;
  IF to_regprocedure('auth.role()') IS NULL THEN
    RAISE EXCEPTION 'PRV preflight: auth.role() is missing — the house service_role policy cannot be expressed';
  END IF;
END
$preflight$;

-- ── A. Per-tenant MarketPulse observations ────────────────────────────────

CREATE TABLE IF NOT EXISTS public.marketpulse_signal_observations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  signal_id        uuid NOT NULL REFERENCES public.marketpulse_signals (id) ON DELETE CASCADE,
  observation_key  text NOT NULL,
  run_id           uuid,
  finding_id       uuid,
  observed_at      timestamptz NOT NULL,
  title            text NOT NULL,
  summary          text NOT NULL,
  source_url       text,
  snapshot         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT mpso_observation_key_namespaced
    CHECK (observation_key ~ '^[a-z][a-z0-9_]{0,39}:.+'),
  CONSTRAINT mpso_snapshot_is_object
    CHECK (jsonb_typeof(snapshot) = 'object'),
  CONSTRAINT uq_mpso_company_signal_observation
    UNIQUE (company_id, signal_id, observation_key)
);

CREATE INDEX IF NOT EXISTS idx_mpso_company_observed
  ON public.marketpulse_signal_observations (company_id, observed_at DESC);
-- Referential-action support for the signal CASCADE.
CREATE INDEX IF NOT EXISTS idx_mpso_signal
  ON public.marketpulse_signal_observations (signal_id);

ALTER TABLE public.marketpulse_signal_observations ENABLE ROW LEVEL SECURITY;

DO $mpso_rls$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'marketpulse_signal_observations'
       AND policyname = 'marketpulse_signal_observations_service_role'
       AND roles::text[] <> ARRAY['service_role']
  ) THEN
    DROP POLICY marketpulse_signal_observations_service_role ON public.marketpulse_signal_observations;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'marketpulse_signal_observations'
       AND policyname = 'marketpulse_signal_observations_service_role'
  ) THEN
    CREATE POLICY marketpulse_signal_observations_service_role
      ON public.marketpulse_signal_observations
      FOR ALL
      TO service_role
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END
$mpso_rls$;

REVOKE ALL ON TABLE public.marketpulse_signal_observations
  FROM PUBLIC, anon, authenticated, authenticator, service_role;
GRANT SELECT, INSERT ON TABLE public.marketpulse_signal_observations TO service_role;

COMMENT ON TABLE public.marketpulse_signal_observations IS
  'Per-tenant observation of a GLOBAL marketpulse_signals row: this tenant''s '
  'own title/summary/source_url/observed_at and the run/finding that produced '
  'it. The shared signal row is insert-only and never carries tenant content '
  'after creation. Append-only (service_role SELECT+INSERT). Writer: '
  'backend/services/marketPulseIntelligenceService.ts.';
COMMENT ON COLUMN public.marketpulse_signal_observations.observation_key IS
  'Namespaced idempotency key per (company_id, signal_id): finding:<id> | run:<id> | content:<sha256>.';
COMMENT ON COLUMN public.marketpulse_signal_observations.run_id IS
  'market_pulse_runs.id of the producing run (opaque correlation reference; not an FK).';
COMMENT ON COLUMN public.marketpulse_signal_observations.finding_id IS
  'market_pulse_findings.id the signal was built from (opaque correlation reference; not an FK).';

-- ── B1. Tenant-safe key on the contribution ledger ────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS uq_psc_id_org
  ON public.prospect_source_contributions (id, organization_id);

-- ── B2. Redaction tombstones ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.prospect_source_contribution_redactions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  contribution_id    uuid,
  canonical_lead_id  uuid NOT NULL,
  reason             text NOT NULL,
  requested_by       text NOT NULL,
  redacted_fields    text[] NOT NULL,
  values_sha256      text NOT NULL,
  redacted_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pscr_reason_nonblank        CHECK (btrim(reason) <> ''),
  CONSTRAINT pscr_requested_by_nonblank  CHECK (btrim(requested_by) <> ''),
  CONSTRAINT pscr_values_sha256_hex      CHECK (values_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT uq_pscr_contribution        UNIQUE (contribution_id)
);

CREATE INDEX IF NOT EXISTS idx_pscr_org_lead
  ON public.prospect_source_contribution_redactions (organization_id, canonical_lead_id);
CREATE INDEX IF NOT EXISTS idx_pscr_org_redacted_at
  ON public.prospect_source_contribution_redactions (organization_id, redacted_at DESC);

DO $pscr_fks$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pscr_contribution_tenant_fk') THEN
    -- Column-list SET NULL: a bare SET NULL on a composite FK would null
    -- organization_id (NOT NULL) and abort the parent delete.
    ALTER TABLE public.prospect_source_contribution_redactions
      ADD CONSTRAINT pscr_contribution_tenant_fk
      FOREIGN KEY (contribution_id, organization_id)
      REFERENCES public.prospect_source_contributions (id, organization_id)
      ON DELETE SET NULL (contribution_id);
  END IF;
END
$pscr_fks$;

ALTER TABLE public.prospect_source_contribution_redactions ENABLE ROW LEVEL SECURITY;

DO $pscr_rls$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'prospect_source_contribution_redactions'
       AND policyname = 'prospect_source_contribution_redactions_service_role'
       AND roles::text[] <> ARRAY['service_role']
  ) THEN
    DROP POLICY prospect_source_contribution_redactions_service_role
      ON public.prospect_source_contribution_redactions;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'prospect_source_contribution_redactions'
       AND policyname = 'prospect_source_contribution_redactions_service_role'
  ) THEN
    CREATE POLICY prospect_source_contribution_redactions_service_role
      ON public.prospect_source_contribution_redactions
      FOR SELECT
      TO service_role
      USING (auth.role() = 'service_role');
  END IF;
END
$pscr_rls$;

REVOKE ALL ON TABLE public.prospect_source_contribution_redactions
  FROM PUBLIC, anon, authenticated, authenticator, service_role;
GRANT SELECT ON TABLE public.prospect_source_contribution_redactions TO service_role;

COMMENT ON TABLE public.prospect_source_contribution_redactions IS
  'Privacy-redaction tombstones for prospect_source_contributions. One row per '
  'redacted contribution: reason, requester, the NAMES of the redacted fields '
  'and a sha256 of the redacted values — never the values. Append-only: '
  'service_role holds SELECT only; written solely by '
  'public.pi_redact_prospect_source_contributions.';
COMMENT ON COLUMN public.prospect_source_contribution_redactions.values_sha256 IS
  'hex sha256 of jsonb_build_object(''source_url'', ''evidence'', ''source_metadata'')::text '
  'as they were immediately before redaction. Proves what was removed without retaining it.';
COMMENT ON COLUMN public.prospect_source_contribution_redactions.contribution_id IS
  'ON DELETE SET NULL (contribution_id): the audit record outlives the contribution.';

-- ── B3. The redaction function ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.pi_redact_prospect_source_contributions(
  p_organization_id    uuid,
  p_canonical_lead_ids uuid[],
  p_reason             text,
  p_requested_by       text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_row        record;
  v_tomb_id    uuid;
  v_fields     text[];
  v_hash       text;
  v_marker     jsonb;
  v_redacted   integer := 0;
  v_already    integer := 0;
  v_ids        uuid[] := ARRAY[]::uuid[];
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'pi_redact_prospect_source_contributions: organization_id is required'
      USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'pi_redact_prospect_source_contributions: reason is required'
      USING ERRCODE = '22023';
  END IF;
  IF p_requested_by IS NULL OR btrim(p_requested_by) = '' THEN
    RAISE EXCEPTION 'pi_redact_prospect_source_contributions: requested_by is required'
      USING ERRCODE = '22023';
  END IF;
  IF p_canonical_lead_ids IS NULL OR cardinality(p_canonical_lead_ids) = 0 THEN
    RETURN jsonb_build_object('redacted', 0, 'already_redacted', 0, 'contribution_ids', '[]'::jsonb);
  END IF;
  IF array_position(p_canonical_lead_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'pi_redact_prospect_source_contributions: lead ids must not contain NULL'
      USING ERRCODE = '22023';
  END IF;

  -- TENANT CHECK. Any requested lead that exists under another tenant refuses
  -- the WHOLE call; nothing is redacted. (A lead id that no longer exists is
  -- not an error: it has no contributions left to redact.)
  IF EXISTS (
    SELECT 1 FROM public.canonical_leads l
     WHERE l.id = ANY (p_canonical_lead_ids)
       AND l.company_id IS DISTINCT FROM p_organization_id
  ) THEN
    RAISE EXCEPTION 'pi_redact_prospect_source_contributions: a requested lead belongs to another tenant'
      USING ERRCODE = '42501';
  END IF;

  SELECT count(*)::int INTO v_already
    FROM public.prospect_source_contributions c
   WHERE c.organization_id = p_organization_id
     AND c.canonical_lead_id = ANY (p_canonical_lead_ids)
     AND EXISTS (SELECT 1 FROM public.prospect_source_contribution_redactions t
                  WHERE t.contribution_id = c.id);

  FOR v_row IN
    SELECT c.id, c.canonical_lead_id, c.source_url, c.evidence, c.source_metadata
      FROM public.prospect_source_contributions c
     WHERE c.organization_id = p_organization_id          -- TENANT FIRST
       AND c.canonical_lead_id = ANY (p_canonical_lead_ids)
       AND NOT EXISTS (SELECT 1 FROM public.prospect_source_contribution_redactions t
                        WHERE t.contribution_id = c.id)
     ORDER BY c.id
     FOR UPDATE OF c
  LOOP
    v_fields := ARRAY[]::text[];
    IF v_row.source_url IS NOT NULL THEN
      v_fields := v_fields || 'source_url'::text;
    END IF;
    v_fields := v_fields
      || coalesce((SELECT array_agg('evidence.' || k ORDER BY k)
                     FROM jsonb_object_keys(v_row.evidence) AS k), ARRAY[]::text[])
      || coalesce((SELECT array_agg('source_metadata.' || k ORDER BY k)
                     FROM jsonb_object_keys(v_row.source_metadata) AS k), ARRAY[]::text[]);

    v_hash := encode(
      pg_catalog.sha256(convert_to(
        jsonb_build_object('source_url', v_row.source_url,
                           'evidence', v_row.evidence,
                           'source_metadata', v_row.source_metadata)::text,
        'UTF8')),
      'hex');

    v_tomb_id := gen_random_uuid();

    INSERT INTO public.prospect_source_contribution_redactions
      (id, organization_id, contribution_id, canonical_lead_id, reason, requested_by,
       redacted_fields, values_sha256)
    VALUES
      (v_tomb_id, p_organization_id, v_row.id, v_row.canonical_lead_id, btrim(p_reason),
       btrim(p_requested_by), v_fields, v_hash)
    ON CONFLICT (contribution_id) DO NOTHING;

    IF NOT FOUND THEN
      -- A concurrent call tombstoned it between our read and our insert.
      v_already := v_already + 1;
      CONTINUE;
    END IF;

    v_marker := jsonb_build_object('redacted', true, 'redaction_id', v_tomb_id);

    UPDATE public.prospect_source_contributions c
       SET source_url      = NULL,
           evidence        = v_marker,
           source_metadata = v_marker
     WHERE c.id = v_row.id
       AND c.organization_id = p_organization_id;

    v_redacted := v_redacted + 1;
    v_ids := v_ids || v_row.id;
  END LOOP;

  RETURN jsonb_build_object(
    'redacted', v_redacted,
    'already_redacted', v_already,
    'contribution_ids', to_jsonb(v_ids));
END
$fn$;

REVOKE ALL ON FUNCTION public.pi_redact_prospect_source_contributions(uuid, uuid[], text, text)
  FROM PUBLIC, anon, authenticated, authenticator;
GRANT EXECUTE ON FUNCTION public.pi_redact_prospect_source_contributions(uuid, uuid[], text, text)
  TO service_role;

COMMENT ON FUNCTION public.pi_redact_prospect_source_contributions(uuid, uuid[], text, text) IS
  'Privacy redaction of a tenant''s contributions for the given canonical leads. '
  'One transaction: refuses (42501) a lead of another tenant; per not-yet-redacted '
  'contribution inserts a tombstone (reason, requester, field names, sha256 of '
  'values) and nulls source_url / replaces evidence and source_metadata with a '
  'redaction marker. Never deletes a contribution. Idempotent. SECURITY DEFINER; '
  'EXECUTE: service_role only. Caller: backend/services/prospectProvenance/redaction.ts.';

-- ── C. Postconditions ─────────────────────────────────────────────────────

DO $verify$
DECLARE
  v_n        int;
  v_rls      boolean;
  v_force    boolean;
  v_priv     text[];
  v_leaked   text[];
  v_def      text;
  v_secdef   boolean;
  v_config   text[];
  v_fn       regprocedure := to_regprocedure(
               'public.pi_redact_prospect_source_contributions(uuid, uuid[], text, text)');
  r          record;
BEGIN
  IF to_regclass('public.marketpulse_signal_observations') IS NULL THEN
    RAISE EXCEPTION 'PRV postcondition: marketpulse_signal_observations is missing';
  END IF;
  IF to_regclass('public.prospect_source_contribution_redactions') IS NULL THEN
    RAISE EXCEPTION 'PRV postcondition: prospect_source_contribution_redactions is missing';
  END IF;
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'PRV postcondition: pi_redact_prospect_source_contributions(uuid, uuid[], text, text) is missing';
  END IF;

  -- A. observation shape
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'uq_mpso_company_signal_observation' AND contype = 'u'
                    AND conrelid = 'public.marketpulse_signal_observations'::regclass
                    AND pg_get_constraintdef(oid) = 'UNIQUE (company_id, signal_id, observation_key)') THEN
    RAISE EXCEPTION 'PRV postcondition: uq_mpso_company_signal_observation must be UNIQUE (company_id, signal_id, observation_key)';
  END IF;
  SELECT count(*) INTO v_n FROM pg_constraint
   WHERE conrelid = 'public.marketpulse_signal_observations'::regclass AND contype = 'f'
     AND confdeltype = 'c'
     AND confrelid IN ('public.companies'::regclass, 'public.marketpulse_signals'::regclass);
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'PRV postcondition: observations must reference companies and marketpulse_signals ON DELETE CASCADE (found %)', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM pg_constraint
   WHERE conrelid = 'public.marketpulse_signal_observations'::regclass AND contype = 'c'
     AND conname IN ('mpso_observation_key_namespaced', 'mpso_snapshot_is_object');
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'PRV postcondition: expected 2 named CHECKs on observations, found %', v_n;
  END IF;

  -- B. tombstone shape
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'uq_pscr_contribution' AND contype = 'u'
                    AND conrelid = 'public.prospect_source_contribution_redactions'::regclass) THEN
    RAISE EXCEPTION 'PRV postcondition: uq_pscr_contribution is missing — redaction would not be idempotent';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
     WHERE c.conname = 'pscr_contribution_tenant_fk' AND c.confdeltype = 'n'
       AND c.conrelid = 'public.prospect_source_contribution_redactions'::regclass
       AND c.confrelid = 'public.prospect_source_contributions'::regclass
       AND array_length(c.conkey, 1) = 2
       AND array_length(c.confdelsetcols, 1) = 1
       AND (SELECT attname FROM pg_attribute
             WHERE attrelid = c.conrelid AND attnum = c.confdelsetcols[1]) = 'contribution_id') THEN
    RAISE EXCEPTION 'PRV postcondition: pscr_contribution_tenant_fk must be a composite FK ON DELETE SET NULL (contribution_id)';
  END IF;
  SELECT pg_get_indexdef(i.indexrelid) INTO v_def
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
   WHERE c.relname = 'uq_psc_id_org'
     AND i.indrelid = 'public.prospect_source_contributions'::regclass
     AND i.indisunique AND i.indisvalid AND i.indpred IS NULL;
  IF v_def IS NULL OR v_def NOT LIKE '%(id, organization_id)' THEN
    RAISE EXCEPTION 'PRV postcondition: uq_psc_id_org must be a valid UNIQUE (id, organization_id), found %', coalesce(v_def, '<absent>');
  END IF;
  SELECT count(*) INTO v_n FROM pg_constraint
   WHERE conrelid = 'public.prospect_source_contribution_redactions'::regclass AND contype = 'c'
     AND conname IN ('pscr_reason_nonblank', 'pscr_requested_by_nonblank', 'pscr_values_sha256_hex');
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'PRV postcondition: expected 3 named CHECKs on tombstones, found %', v_n;
  END IF;

  -- RLS enabled, not forced, exactly one service_role policy — both tables.
  FOR r IN SELECT * FROM (VALUES
      ('marketpulse_signal_observations', 'marketpulse_signal_observations_service_role'),
      ('prospect_source_contribution_redactions', 'prospect_source_contribution_redactions_service_role')) AS t(tbl, pol)
  LOOP
    SELECT c.relrowsecurity, c.relforcerowsecurity INTO v_rls, v_force
      FROM pg_class c WHERE c.oid = ('public.' || r.tbl)::regclass;
    IF NOT v_rls OR v_force THEN
      RAISE EXCEPTION 'PRV postcondition: % must have RLS enabled and not forced', r.tbl;
    END IF;
    SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'public' AND tablename = r.tbl;
    IF v_n <> 1 OR NOT EXISTS (SELECT 1 FROM pg_policies
                                WHERE schemaname = 'public' AND tablename = r.tbl
                                  AND policyname = r.pol AND roles::text[] = ARRAY['service_role']) THEN
      RAISE EXCEPTION 'PRV postcondition: % must carry exactly one policy, %, for {service_role}', r.tbl, r.pol;
    END IF;
  END LOOP;

  -- Table privileges: expected service_role sets; nothing for client roles / PUBLIC.
  FOR r IN SELECT * FROM (VALUES
      ('marketpulse_signal_observations',          ARRAY['INSERT', 'SELECT']),
      ('prospect_source_contribution_redactions',  ARRAY['SELECT']),
      ('prospect_source_contributions',            ARRAY['INSERT', 'SELECT'])) AS t(tbl, expected)
  LOOP
    SELECT array_agg(DISTINCT a.privilege_type ORDER BY a.privilege_type) INTO v_priv
      FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
      JOIN pg_roles r2 ON r2.oid = a.grantee
     WHERE c.oid = ('public.' || r.tbl)::regclass AND r2.rolname = 'service_role';
    IF v_priv IS DISTINCT FROM r.expected THEN
      RAISE EXCEPTION 'PRV postcondition: service_role on % must hold exactly %, found %',
        r.tbl, r.expected, coalesce(v_priv::text, '{}');
    END IF;

    SELECT array_agg(DISTINCT r2.rolname || ':' || a.privilege_type) INTO v_leaked
      FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
      JOIN pg_roles r2 ON r2.oid = a.grantee
     WHERE c.oid = ('public.' || r.tbl)::regclass
       AND r2.rolname IN ('anon', 'authenticated', 'authenticator');
    IF v_leaked IS NOT NULL THEN
      RAISE EXCEPTION 'PRV postcondition: client roles must hold nothing on %, found %', r.tbl, v_leaked;
    END IF;

    SELECT count(*) INTO v_n
      FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
     WHERE c.oid = ('public.' || r.tbl)::regclass AND a.grantee = 0;
    IF v_n <> 0 THEN
      RAISE EXCEPTION 'PRV postcondition: PUBLIC must hold nothing on %, found % grant(s)', r.tbl, v_n;
    END IF;
  END LOOP;

  -- The function: SECURITY DEFINER, search_path pinned, EXECUTE = service_role only.
  SELECT p.prosecdef, p.proconfig INTO v_secdef, v_config FROM pg_proc p WHERE p.oid = v_fn;
  IF NOT v_secdef THEN
    RAISE EXCEPTION 'PRV postcondition: the redaction function must be SECURITY DEFINER';
  END IF;
  IF v_config IS NULL OR NOT (v_config @> ARRAY['search_path=""']) THEN
    RAISE EXCEPTION 'PRV postcondition: the redaction function must pin search_path to empty, found %', v_config;
  END IF;
  IF has_function_privilege('anon', v_fn, 'EXECUTE')
     OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
     OR has_function_privilege('authenticator', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'PRV postcondition: anon / authenticated / authenticator must not EXECUTE the redaction function';
  END IF;
  SELECT count(*) INTO v_n
    FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
   WHERE p.oid = v_fn AND a.grantee = 0;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'PRV postcondition: PUBLIC must not EXECUTE the redaction function';
  END IF;
  IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'PRV postcondition: service_role must EXECUTE the redaction function';
  END IF;

  RAISE NOTICE 'PRV: verified — marketpulse_signal_observations (tenant + signal CASCADE, idempotency key, RLS, service_role SELECT+INSERT); prospect_source_contribution_redactions (composite SET NULL (contribution_id) FK, unique per contribution, 3 CHECKs, RLS, service_role SELECT only); pi_redact_prospect_source_contributions SECURITY DEFINER, search_path pinned, EXECUTE service_role only; prospect_source_contributions still service_role {INSERT,SELECT}.';
END
$verify$;

COMMIT;

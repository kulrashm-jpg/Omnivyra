-- PI / Prospect Problem Observation — the capture relation.
--
-- WHAT THIS STORES. A problem **explicitly stated by, or attributable to, a
-- prospect**, kept verbatim with enough provenance to tell what the prospect
-- actually said apart from an inference the platform made. The shared contract
-- is `backend/services/prospectProblems/types.ts`; this table is its storage and
-- nothing else.
--
-- ─── WHY NOT `source_assertions` ──────────────────────────────────────────
-- An observation is an UTTERANCE: plural, historical, and never arbitrated. Two
-- problems stated two months apart are BOTH true and neither supersedes the
-- other. `source_assertions` exists to arbitrate competing claims about one
-- attribute — it carries `normalized_value`, `applied_to_canonical_at`,
-- `applied_reason` and `superseded_at`, and its recency rule would silently
-- discard the older of two true statements. Putting utterances there would turn
-- a visibly-plural history into a confidently-wrong single value.
--
-- So this table deliberately carries NONE of:
--   normalized_value       there is no deterministic normalisation of a
--                          sentence, and inventing one would be the classifier
--                          the contract refuses;
--   superseded_at          nothing here is ever superseded;
--   applied_* / canonical  nothing here is ever promoted to a canonical column;
--   problem_domain, any classification, score, weight, dimension or priority.
--                          Capturing what a prospect said is not deciding what
--                          it is worth. Problem FIT is a separate, still
--                          UNSCORED relation (`20261013000000` leaves where fit
--                          lives undecided), and nothing in this migration
--                          produces, implies or enables a score.
--
-- ─── TENANT MODEL (unchanged from W5/LI-1/LI-2) ───────────────────────────
--   organization_id = TENANT (FK -> companies)
--   person_id       -> the canonical person via composite (person_id, organization_id)
--   account_id      -> the canonical account via composite (account_id, organization_id)
--   source_record_id-> source_records via composite (source_record_id, organization_id)
--
-- SAFE TO APPLY. One new table. No existing table, constraint, index, trigger,
-- policy or row is touched, read for migration purposes, or rewritten.
-- **NOT APPLIED** to any database by the gate that authored it.
--
-- Preflight preconditions ONLY on W1/LI-2 objects. `person_account_relationships`
-- and `attribute_authority_declarations` are deliberately NOT preconditions:
-- 20261119/20261120/20261121/20261122 are unapplied in production, and a
-- preflight naming them would fail there for a reason unrelated to this table.

BEGIN;

-- ---------------------------------------------------------------------------
-- Preflight — fail closed on a missing prerequisite rather than create a table
-- whose tenant-safe references cannot be built.
-- ---------------------------------------------------------------------------
DO $preflight$
BEGIN
  IF to_regclass('public.companies') IS NULL THEN
    RAISE EXCEPTION 'PPO preflight: public.companies is missing — there is no tenant to own an observation';
  END IF;

  IF to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION 'PPO preflight: public.users is missing — a human-attested statement could not name its recorder';
  END IF;

  IF to_regclass('public.unified_persons') IS NULL OR to_regclass('public.prospect_accounts') IS NULL THEN
    RAISE EXCEPTION 'PPO preflight: the canonical spine is missing';
  END IF;

  IF to_regclass('public.source_records') IS NULL THEN
    RAISE EXCEPTION 'PPO preflight: LI-2 source_records is missing — the provenance spine is a prerequisite';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname='public' AND indexname='uq_unified_persons_id_company') THEN
    RAISE EXCEPTION 'PPO preflight: uq_unified_persons_id_company missing — cannot build a tenant-safe person reference';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname='public' AND indexname='uq_prospect_accounts_id_org') THEN
    RAISE EXCEPTION 'PPO preflight: uq_prospect_accounts_id_org missing — cannot build a tenant-safe account reference';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname='public' AND indexname='uq_source_records_id_org') THEN
    RAISE EXCEPTION 'PPO preflight: uq_source_records_id_org missing — cannot build a tenant-safe provenance reference';
  END IF;

  IF to_regprocedure('public.omnivyra_touch_updated_at()') IS NULL THEN
    RAISE EXCEPTION 'PPO preflight: omnivyra_touch_updated_at() is missing — the house updated_at convention is unavailable';
  END IF;
END
$preflight$;

-- ---------------------------------------------------------------------------
-- prospect_problem_observations — one row per statement, per source record.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.prospect_problem_observations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- TENANT. Every observation belongs to exactly one tenant, always. A
  -- tenant-less statement is unattributable and is never valid.
  organization_id     uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,

  -- ── THE SUBJECT: EXACTLY ONE CANONICAL ENTITY ───────────────────────────
  -- `entity_type` declares which leg is populated, and the CHECK below makes
  -- the declaration and the data agree. A statement attributed to nothing, or
  -- to two different kinds of thing at once, is not a usable observation.
  entity_type         text NOT NULL,
  person_id           uuid,
  account_id          uuid,

  -- ── THE WORDS ───────────────────────────────────────────────────────────
  -- The prospect's own statement. Whitespace-normalised by the caller, NEVER
  -- summarised, truncated or rewritten.
  --
  -- THERE IS DELIBERATELY NO NORMALISED TWIN. `source_assertions` keeps raw and
  -- normalized values because an attribute value HAS a deterministic canonical
  -- form; a sentence does not. Any "normalised statement" column would have to
  -- be produced by a classifier, and a classifier is precisely what the
  -- contract refuses to introduce here. Dedupe therefore keys on the hash of
  -- the statement exactly as stored.
  statement           text NOT NULL,
  -- sha256 of the trimmed statement, lowercase hex, computed by the application
  -- with the same helper that produces `source_assertions.value_hash`.
  statement_hash      text NOT NULL,
  -- As the source reported it. NULL is "not stated", never a guess: inferring a
  -- language from the text would be a classification this table does not make.
  statement_language  text,

  -- ── WHERE THE WORDS CAN BE RE-READ ──────────────────────────────────────
  -- `origin_store` is free text ON PURPOSE, for the same reason
  -- `source_records.provider` is: a CRM note, a call record, an email thread or
  -- a source nobody has thought of yet must never require a migration.
  --
  -- It may never name THIS relation. An origin of
  -- 'prospect_problem_observations' would make the record its own evidence — a
  -- statement attributed to nothing but the fact that someone typed it. The
  -- capture boundary refuses it (SELF_ATTRIBUTED_ORIGIN_STORES in the shared
  -- contract); it is stated here so the reason survives beside the column.
  origin_store        text NOT NULL,
  origin_record_id    text NOT NULL,

  -- Optional link to the LI-2 provenance spine. Optional because a statement
  -- can legitimately arrive from a store that produced no source record (an
  -- operator reading a call transcript), and fabricating a source record to
  -- satisfy a NOT NULL would invent provenance.
  source_record_id    uuid,

  -- ── WHO RECORDED IT, NOT WHAT IT SAYS ───────────────────────────────────
  -- 'provider' — the statement arrived inside a provider record.
  -- 'human'    — an operator recorded it from an artefact they can name.
  -- A human origin REQUIRES a recording user, so an attested statement is never
  -- anonymous; a provider origin must NOT carry one, so a machine import can
  -- never be dressed up as a person's attestation. The pairing is a CHECK
  -- rather than an application rule because the rule is what makes the
  -- distinction trustworthy.
  origin              text NOT NULL DEFAULT 'provider',
  recorded_by_user_id uuid REFERENCES public.users (id) ON DELETE SET NULL,

  -- The SOURCE's own confidence in 0..1. NULLABLE WITH NO DEFAULT: a default
  -- would state a confidence no source expressed, and "the source said nothing
  -- about how sure it was" is a different fact from "the source said 1.0".
  confidence          numeric,

  -- ── TIME: TWO CLOCKS, NEVER ONE ─────────────────────────────────────────
  -- `observed_at` is when the PROSPECT said it, as the source reported it. It
  -- is NULLABLE WITH NO DEFAULT, deliberately and in contrast to
  -- `identity_claims.observed_at`, which defaults to now(). Substituting the
  -- ingest clock for an absent source time is the exact failure the contract
  -- forbids: it manufactures a timestamp that later reads as evidence of when
  -- the prospect spoke. An absent source time is an ABSENCE.
  observed_at         timestamptz,
  -- OUR clock. Distinct by contract; one is never read for the other.
  recorded_at         timestamptz NOT NULL DEFAULT now(),

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  -- THERE IS DELIBERATELY NO `CHECK (observed_at <= recorded_at)`. Source
  -- clocks drift, and modest skew is ordinary; such a CHECK would make a TRUE
  -- observation unstorable and would push the writer towards "correcting" the
  -- source time, which is the fabrication this table exists to prevent.

  CONSTRAINT ppo_entity_type_valid
    CHECK (entity_type IN ('person', 'account')),

  -- EXACTLY ONE SUBJECT, AND IT MATCHES THE DECLARED TYPE.
  CONSTRAINT ppo_one_subject CHECK (
    (entity_type = 'person'  AND person_id  IS NOT NULL AND account_id IS NULL)
    OR
    (entity_type = 'account' AND account_id IS NOT NULL AND person_id  IS NULL)
  ),

  CONSTRAINT ppo_statement_not_blank
    CHECK (length(btrim(statement)) > 0),
  -- A sha256 in lowercase hex or it is not a hash. This is what stops a
  -- caller-supplied label being stored where an identity belongs.
  CONSTRAINT ppo_statement_hash_shape
    CHECK (statement_hash ~ '^[a-f0-9]{64}$'),

  CONSTRAINT ppo_origin_store_not_blank
    CHECK (length(btrim(origin_store)) > 0),
  CONSTRAINT ppo_origin_record_id_not_blank
    CHECK (length(btrim(origin_record_id)) > 0),

  CONSTRAINT ppo_origin_valid
    CHECK (origin IN ('provider', 'human')),
  -- human  <=> a recording user is named
  -- provider <=> no recording user
  CONSTRAINT ppo_origin_actor CHECK (
    (origin = 'human'    AND recorded_by_user_id IS NOT NULL)
    OR
    (origin = 'provider' AND recorded_by_user_id IS NULL)
  ),

  CONSTRAINT ppo_confidence_range
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1))
);

-- ── IDEMPOTENCY ──────────────────────────────────────────────────────────────────────
-- The key: one row per (tenant, origin store, origin record, statement,
-- SUBJECT). A replay raises 23505 and the writer counts it as already stored
-- — never a second row, and never a SELECT-then-INSERT race.
--
-- TIME-FREE, DELIBERATELY: a retry that re-parses a timestamp slightly
-- differently must not create a second row for one utterance, so `observed_at`
-- is not in the key. Two genuinely different utterances in one source record
-- differ by `statement_hash`; the same words in two different source records are
-- two observations and differ by `origin_record_id`.
--
-- SUBJECT-AWARE, CORRECTED: an earlier revision of this migration left the
-- subject OUT of the key, on the stated grounds that "a statement recorded
-- before identity resolves, and re-recorded after, must not duplicate". That
-- justification was unreachable. `ppo_one_subject` requires the declared leg to
-- be NOT NULL, so this table cannot hold a subjectless observation and the race
-- it protected against cannot occur here. What the omission did cost was real:
-- one call record naming two people who said the same sentence stored ONE row,
-- attributed to whichever arrived first, and the second attribution was lost
-- silently. Two people stating the same problem is ordinary, not a duplicate.
--
-- WHY TWO PARTIAL INDEXES RATHER THAN ONE WIDER ONE: because exactly one
-- subject leg is populated, a single index over both legs would compare a NULL
-- in every row. Under the default NULLS DISTINCT that makes account rows
-- (person_id NULL) never conflict with each other — idempotency would quietly
-- disappear for half the table while the index still looked correct.
-- `NULLS NOT DISTINCT` would fix that and IS available here (PostgreSQL 17.6,
-- and seven migrations already use it, `20261031000000_pi_score_evaluations`
-- among them). It was still not chosen: a partial index per leg depends on no
-- NULL semantics at all, indexes only the rows it governs, and mirrors the two
-- partial read indexes below. Nothing is inferred by `ON CONFLICT` — the writer
-- issues a plain insert and reads 23505 — so partiality costs no inference.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ppo_person_origin_statement
  ON public.prospect_problem_observations
     (organization_id, origin_store, origin_record_id, statement_hash, person_id)
  WHERE entity_type = 'person';

CREATE UNIQUE INDEX IF NOT EXISTS uq_ppo_account_origin_statement
  ON public.prospect_problem_observations
     (organization_id, origin_store, origin_record_id, statement_hash, account_id)
  WHERE entity_type = 'account';

-- The read this table exists to serve: "what has this subject said, newest
-- first". Partial per leg, because exactly one is ever populated.
CREATE INDEX IF NOT EXISTS idx_ppo_org_person_observed
  ON public.prospect_problem_observations (organization_id, person_id, observed_at DESC)
  WHERE person_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ppo_org_account_observed
  ON public.prospect_problem_observations (organization_id, account_id, observed_at DESC)
  WHERE account_id IS NOT NULL;

-- ── TENANT-SAFE COMPOSITE FOREIGN KEYS ─────────────────────────────────────
-- Composite on (subject, tenant) following the W5/LI-2 pattern, so a row can
-- never name a subject belonging to another tenant. Note the ASYMMETRIC parent
-- columns: the person spine keys its tenant as `company_id`, the account spine
-- as `organization_id`.
--
-- ─── WHY THE SUBJECT LEGS CASCADE, WHERE LI-2 SETS NULL ───────────────────
-- Two independent reasons, and either alone would be decisive.
--
-- 1. ERASURE. `source_records` and `source_assertions` SET NULL because
--    evidence ABOUT an entity may outlive it. Here the row IS the personal
--    data: a verbatim statement made by a named human. SET NULL would leave the
--    full text, the tenant and the provenance behind under a nulled subject —
--    an orphan that no erasure procedure revisits because nothing points at it
--    any more. CASCADE deletes the words with the person, which is the only
--    behaviour an erasure request can actually satisfy.
--
-- 2. DEFECT-008. A referential SET NULL is an UPDATE, and PostgreSQL
--    re-evaluates every table CHECK on the updated row. `ppo_one_subject`
--    requires the declared leg to be non-null, so nulling it would fail the
--    CHECK and abort the parent DELETE with 23514 — making the person
--    undeletable. That is exactly the failure `20261027000000` exists to fix on
--    `contact_governance_records`, and reproducing it here would be a known bug
--    re-introduced on purpose. CASCADE removes the row instead of updating it,
--    so no CHECK is ever re-evaluated.
--
-- The provenance leg is RESTRICT, not CASCADE: a source record must not be
-- deletable while a statement still cites it as the place its words can be
-- re-read, and the statement itself is not the source record's to destroy.
DO $ppo_fks$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ppo_person_tenant_fk') THEN
    ALTER TABLE public.prospect_problem_observations
      ADD CONSTRAINT ppo_person_tenant_fk
      FOREIGN KEY (person_id, organization_id)
      REFERENCES public.unified_persons (id, company_id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ppo_account_tenant_fk') THEN
    ALTER TABLE public.prospect_problem_observations
      ADD CONSTRAINT ppo_account_tenant_fk
      FOREIGN KEY (account_id, organization_id)
      REFERENCES public.prospect_accounts (id, organization_id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ppo_source_record_tenant_fk') THEN
    ALTER TABLE public.prospect_problem_observations
      ADD CONSTRAINT ppo_source_record_tenant_fk
      FOREIGN KEY (source_record_id, organization_id)
      REFERENCES public.source_records (id, organization_id) ON DELETE RESTRICT;
  END IF;
END
$ppo_fks$;

-- ── updated_at, by the house convention ────────────────────────────────────
DO $ppo_trigger$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'prospect_problem_observations_touch_updated_at'
       AND tgrelid = 'public.prospect_problem_observations'::regclass
  ) THEN
    CREATE TRIGGER prospect_problem_observations_touch_updated_at
      BEFORE UPDATE ON public.prospect_problem_observations
      FOR EACH ROW EXECUTE FUNCTION public.omnivyra_touch_updated_at();
  END IF;
END
$ppo_trigger$;

-- ── RLS ────────────────────────────────────────────────────────────────────
-- Supabase grants ALL on every new public table to `authenticated`, and
-- PostgREST serves it. `20261026000000_close_anon_rls_exposure.sql` revoked the
-- defaults for `anon` but only TRUNCATE for `authenticated`, so without RLS
-- every signed-up user of every tenant could read — and write — verbatim
-- statements made by other tenants' prospects. That is both a cross-tenant data
-- leak and a route to fabricated attributed speech.
--
-- Same treatment as `source_records` and `prospect_discovery_attempts`: enable
-- RLS, carry exactly one policy, and give `authenticated` no policy at all.
-- Every access goes through the single repository module on the server
-- credential.
--
-- ─── WHAT THE POLICY DOES FOR THE SERVER CREDENTIAL: NOTHING ──────────────
-- An earlier revision of this comment said the design was to "give service_role
-- an explicit policy", which implies the policy governs that role's access. It
-- does not. `service_role` is created BYPASSRLS, so PostgreSQL never evaluates a
-- policy for it: a policy reading `auth.role() = 'service_role'` can neither
-- admit it to a row it could not already reach nor withhold one it could.
--
-- For the server credential the EFFECTIVE controls are exactly two:
--   1. the TABLE PRIVILEGES granted immediately below — SELECT and INSERT, and
--      nothing else, so even a defect in the repository cannot UPDATE, DELETE or
--      TRUNCATE a verbatim statement; and
--   2. application-layer authorization — the repository module and the capability
--      boundary above it, which is where tenant scoping is actually decided.
--
-- The policy is the DEFAULT-DENY BACKSTOP FOR EVERY OTHER ROLE. With RLS enabled
-- and no policy admitting them, `anon`, `authenticated` and any role added later
-- see no rows even if some future migration or a managed-project default hands
-- one of them a privilege. That is precisely why it must be scoped `TO
-- service_role`: a policy with no TO clause applies to PUBLIC — `pg_policies.roles`
-- reads `{public}` — which makes the backstop look like a way in for every role.
--
-- ENABLE, never FORCE — FORCE would subject the table OWNER too and break
-- owner-connection realschema suites.
ALTER TABLE public.prospect_problem_observations ENABLE ROW LEVEL SECURITY;

DO $ppo_rls$
BEGIN
  -- Converge, do not merely create. A policy with no TO clause applies to
  -- PUBLIC, which is the defect this migration corrects, so a pre-existing
  -- policy whose role set is not exactly {service_role} is replaced.
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'prospect_problem_observations'
       AND policyname = 'prospect_problem_observations_service_role'
       AND roles::text[] <> ARRAY['service_role']
  ) THEN
    DROP POLICY prospect_problem_observations_service_role
      ON public.prospect_problem_observations;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'prospect_problem_observations'
       AND policyname = 'prospect_problem_observations_service_role'
  ) THEN
    CREATE POLICY prospect_problem_observations_service_role
      ON public.prospect_problem_observations
      FOR ALL
      TO service_role
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END
$ppo_rls$;

-- ── TABLE PRIVILEGES — the controls that actually bind the server credential ──
-- DERIVED FROM THE REPOSITORY, not assumed.
-- `backend/services/prospectProblems/problemObservationRepository.ts` performs
-- exactly two operations on this relation: `.insert(row).select(...)` and
-- `.select(...)`. The insert asks for its representation back, so SELECT is
-- required ALONGSIDE INSERT. There is no UPDATE, no DELETE, no upsert and no RPC
-- anywhere in that module, so the privilege set is exactly `SELECT, INSERT` and
-- no UPDATE, DELETE, TRUNCATE, REFERENCES or TRIGGER is granted.
--
-- NO SEQUENCE GRANTS. The primary key is `uuid DEFAULT gen_random_uuid()`; there
-- is no identity or serial column, so there is no sequence for a role to hold
-- USAGE on and nothing to revoke.
--
-- WHY `PUBLIC`, `anon` AND `authenticated` ARE ALL THREE NAMED. `PUBLIC` is the
-- inheritance path that makes the other two revokes meaningful: a privilege held
-- by PUBLIC is held by every role, so revoking from `anon` and `authenticated`
-- alone would leave them reaching the table through PUBLIC. The converse is just
-- as true, and is the half usually missed: revoking from `PUBLIC` does NOT
-- remove a privilege granted DIRECTLY to a role, and a managed Supabase project
-- grants `authenticated` directly on every new public table. Neither revoke
-- subsumes the other, so all three are named. Same posture as
-- `20261211000001_rbac_config_pre_c7_privilege_reduction.sql:56-57`.
--
-- WHY HERE, AFTER `CREATE TABLE`, IN THIS SAME MIGRATION. Whatever a managed
-- project's default privileges conveyed at creation a couple of hundred lines
-- above is withdrawn right here, inside the same transaction, before the relation
-- is ever reachable over PostgREST. The table never exists in a committed state
-- carrying a privilege nobody chose.
--
-- `service_role` AND `authenticator` ARE IN THE REVOKE LIST TOO, and that is
-- not belt-and-braces. A managed Supabase project's default privileges convey
-- ALL on every new public table to all three API roles, so at `CREATE TABLE`
-- above this relation already carries DELETE/INSERT/REFERENCES/SELECT/TRIGGER/
-- TRUNCATE/UPDATE for `service_role`. Revoking only PUBLIC/anon/authenticated
-- would leave that surplus in place, the GRANT below would be a no-op, and the
-- postcondition asserting the EXACT derived set would raise and abort the
-- apply — in production and in any harness that reproduces those defaults.
-- Withdrawing everything and conveying back only what the writer uses is the
-- same shape as the file this posture cites, which revokes from the same five
-- grantees before granting back. `authenticator` never needs a direct
-- privilege: PostgREST connects as it and then SET ROLEs, so a direct grant
-- there would be an unaudited path to the data.
REVOKE ALL ON TABLE public.prospect_problem_observations
  FROM PUBLIC, anon, authenticated, authenticator, service_role;
GRANT SELECT, INSERT ON TABLE public.prospect_problem_observations TO service_role;

-- ---------------------------------------------------------------------------
-- Documentation.
-- ---------------------------------------------------------------------------
COMMENT ON TABLE public.prospect_problem_observations IS
  'PI: a problem STATED BY a prospect, kept verbatim. An utterance — plural, '
  'historical and never arbitrated — which is why it is not an attribute and '
  'does not live on source_assertions. Carries no score, weight, dimension, '
  'classification, normalized value or superseded_at, and promotes nothing to a '
  'canonical column.';

COMMENT ON COLUMN public.prospect_problem_observations.statement IS
  'The prospect''s own words. Never summarised, truncated or rewritten. There '
  'is deliberately NO normalised twin: a sentence has no deterministic '
  'canonical form, and producing one would require the classifier this '
  'capability refuses to introduce.';

COMMENT ON COLUMN public.prospect_problem_observations.statement_hash IS
  'sha256 (lowercase hex) of the trimmed statement. Dedupe identity only; never '
  'a caller-supplied label.';

COMMENT ON COLUMN public.prospect_problem_observations.statement_language IS
  'As the SOURCE reported it. NULL means not stated — never a detected guess.';

COMMENT ON COLUMN public.prospect_problem_observations.origin_store IS
  'WHERE THE WORDS CAN BE RE-READ (a CRM note, a call record, an email thread). '
  'Free text on purpose: a new source must never require a migration. It may '
  'never name this relation — evidence may not cite itself.';

COMMENT ON COLUMN public.prospect_problem_observations.origin IS
  'WHO recorded it, not what it says: provider | human. A human origin requires '
  'a recording user and a provider origin forbids one, enforced by '
  'ppo_origin_actor, so an attested statement is never anonymous and an import '
  'is never dressed up as an attestation.';

COMMENT ON COLUMN public.prospect_problem_observations.observed_at IS
  'When the PROSPECT said it, as the source reported it. NULLABLE WITH NO '
  'DEFAULT: the ingest clock is never substituted, because an absent source '
  'time is an absence and a defaulted one reads later as evidence.';

COMMENT ON COLUMN public.prospect_problem_observations.recorded_at IS
  'OUR clock — when we stored it. Distinct from observed_at by contract; one is '
  'never read for the other.';

COMMENT ON COLUMN public.prospect_problem_observations.confidence IS
  'The SOURCE''s own confidence in 0..1, or an explicit NULL. Never defaulted — '
  'and never a score this platform computed.';

COMMENT ON COLUMN public.prospect_problem_observations.source_record_id IS
  'Optional link to the LI-2 provenance spine. ON DELETE RESTRICT: a source '
  'record may not be deleted while a statement still cites it.';

-- ---------------------------------------------------------------------------
-- Postconditions.
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE
  v_fk  INT;
  v_idx INT;
  v_chk INT;
  v_rls         BOOLEAN;
  v_force       BOOLEAN;
  v_pol_count   INT;
  v_pol_roles   text[];
  v_priv        text[];
  v_leaked      text[];
  v_public_acl  INT;
BEGIN
  IF to_regclass('public.prospect_problem_observations') IS NULL THEN
    RAISE EXCEPTION 'PPO postcondition: the table is missing';
  END IF;

  -- Three composite tenant-safe foreign keys: person, account, source record.
  SELECT count(*) INTO v_fk
    FROM pg_constraint con
    JOIN pg_class s ON s.oid = con.conrelid
   WHERE con.contype = 'f'
     AND s.relname = 'prospect_problem_observations'
     AND array_length(con.conkey, 1) = 2;
  IF v_fk <> 3 THEN
    RAISE EXCEPTION 'PPO postcondition: expected 3 composite tenant FKs, found %', v_fk;
  END IF;

  -- The subject legs CASCADE; the provenance leg RESTRICTs. Asserted because
  -- SET NULL here would both orphan personal data and reproduce DEFECT-008.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'ppo_person_tenant_fk' AND confdeltype = 'c')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'ppo_account_tenant_fk' AND confdeltype = 'c') THEN
    RAISE EXCEPTION 'PPO postcondition: both subject FKs must be ON DELETE CASCADE';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'ppo_source_record_tenant_fk' AND confdeltype = 'r') THEN
    RAISE EXCEPTION 'PPO postcondition: the provenance FK must be ON DELETE RESTRICT';
  END IF;

  SELECT count(*) INTO v_idx FROM pg_indexes
   WHERE schemaname = 'public'
     AND indexname IN ('uq_ppo_person_origin_statement',
                       'uq_ppo_account_origin_statement',
                       'idx_ppo_org_person_observed',
                       'idx_ppo_org_account_observed');
  IF v_idx <> 4 THEN
    RAISE EXCEPTION 'PPO postcondition: expected 4 named indexes, found %', v_idx;
  END IF;

  -- Both idempotency indexes must be PARTIAL. A non-partial one would compare a
  -- NULL subject leg in every row and lose idempotency for one subject kind.
  IF EXISTS (SELECT 1 FROM pg_indexes
              WHERE schemaname = 'public'
                AND indexname IN ('uq_ppo_person_origin_statement',
                                  'uq_ppo_account_origin_statement')
                AND indexdef NOT LIKE '%WHERE%') THEN
    RAISE EXCEPTION 'PPO postcondition: the idempotency indexes must be partial';
  END IF;

  -- The invariants that make a stored statement trustworthy.
  SELECT count(*) INTO v_chk
    FROM pg_constraint con
    JOIN pg_class s ON s.oid = con.conrelid
   WHERE con.contype = 'c'
     AND s.relname = 'prospect_problem_observations'
     AND con.conname IN ('ppo_entity_type_valid', 'ppo_one_subject',
                         'ppo_statement_not_blank', 'ppo_statement_hash_shape',
                         'ppo_origin_valid', 'ppo_origin_actor',
                         'ppo_confidence_range');
  IF v_chk <> 7 THEN
    RAISE EXCEPTION 'PPO postcondition: expected 7 named CHECK constraints, found %', v_chk;
  END IF;

  -- `observed_at` must have NO default. A default here would silently
  -- substitute the ingest clock for the prospect's.
  IF EXISTS (SELECT 1 FROM pg_attrdef ad
               JOIN pg_attribute a ON a.attrelid = ad.adrelid AND a.attnum = ad.adnum
              WHERE ad.adrelid = 'public.prospect_problem_observations'::regclass
                AND a.attname IN ('observed_at', 'confidence')) THEN
    RAISE EXCEPTION 'PPO postcondition: observed_at and confidence must carry no DEFAULT';
  END IF;

  -- This migration creates no data.
  IF (SELECT count(*) FROM public.prospect_problem_observations) <> 0 THEN
    RAISE EXCEPTION 'PPO postcondition: the table must be empty on arrival';
  END IF;

  -- ── RLS: ENABLED, and deliberately NOT FORCED ───────────────────────────
  SELECT c.relrowsecurity, c.relforcerowsecurity
    INTO v_rls, v_force
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'prospect_problem_observations';
  IF NOT v_rls THEN
    RAISE EXCEPTION 'PPO postcondition: row level security must be ENABLED — without it every authenticated user of every tenant could read these statements';
  END IF;
  IF v_force THEN
    RAISE EXCEPTION 'PPO postcondition: row level security must NOT be FORCED — FORCE would subject the table owner and break owner-connection realschema suites';
  END IF;

  -- ── EXACTLY ONE POLICY, SCOPED TO EXACTLY {service_role} ────────────────
  -- A policy with no TO clause reports roles = {public} and applies to every
  -- role, so the role set is asserted as a WHOLE ARRAY: a `{public}` policy must
  -- fail here rather than pass a mere existence check.
  SELECT count(*) INTO v_pol_count
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'prospect_problem_observations';
  IF v_pol_count <> 1 THEN
    RAISE EXCEPTION 'PPO postcondition: expected exactly 1 policy on the relation, found %', v_pol_count;
  END IF;

  SELECT roles::text[] INTO v_pol_roles
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename  = 'prospect_problem_observations'
     AND policyname = 'prospect_problem_observations_service_role';
  IF v_pol_roles IS NULL THEN
    RAISE EXCEPTION 'PPO postcondition: policy prospect_problem_observations_service_role is missing';
  END IF;
  IF v_pol_roles <> ARRAY['service_role'] THEN
    RAISE EXCEPTION 'PPO postcondition: the policy must apply to exactly {service_role}, found %', v_pol_roles;
  END IF;

  -- ── PRIVILEGES, READ FROM pg_class.relacl ───────────────────────────────
  -- Deliberately NOT from information_schema.role_table_grants: that view shows
  -- only grants visible to the enabled session role, so it can read falsely
  -- empty and would turn these assertions into no-ops exactly when they matter.
  SELECT array_agg(DISTINCT a.privilege_type ORDER BY a.privilege_type)
    INTO v_priv
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(c.relacl) a
    JOIN pg_roles r ON r.oid = a.grantee
   WHERE n.nspname = 'public'
     AND c.relname = 'prospect_problem_observations'
     AND r.rolname = 'service_role';
  IF v_priv IS DISTINCT FROM ARRAY['INSERT', 'SELECT'] THEN
    RAISE EXCEPTION 'PPO postcondition: service_role must hold exactly {INSERT,SELECT} on the relation (the repository only inserts and selects), found %',
      coalesce(v_priv::text, '{}');
  END IF;

  -- `anon` and `authenticated` must hold NOTHING at all.
  SELECT array_agg(DISTINCT r.rolname || ':' || a.privilege_type
                   ORDER BY r.rolname || ':' || a.privilege_type)
    INTO v_leaked
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(c.relacl) a
    JOIN pg_roles r ON r.oid = a.grantee
   WHERE n.nspname = 'public'
     AND c.relname = 'prospect_problem_observations'
     -- `authenticator` is in this list because the REVOKE above names it:
     -- PostgREST connects as that role and then SET ROLEs, so a direct
     -- grant there would be an unaudited path straight to the rows.
     AND r.rolname IN ('anon', 'authenticated', 'authenticator');
  IF v_leaked IS NOT NULL THEN
    RAISE EXCEPTION 'PPO postcondition: anon and authenticated must hold no privilege on the relation, found %', v_leaked;
  END IF;

  -- ...and neither must PUBLIC. aclexplode reports a PUBLIC grant with
  -- grantee = 0, which joins to no row in pg_roles, so it vanishes from the two
  -- assertions above and has to be checked on its own.
  SELECT count(*) INTO v_public_acl
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(c.relacl) a
   WHERE n.nspname = 'public'
     AND c.relname = 'prospect_problem_observations'
     AND a.grantee = 0;
  IF v_public_acl <> 0 THEN
    RAISE EXCEPTION 'PPO postcondition: PUBLIC must hold no privilege on the relation, found % grant(s)', v_public_acl;
  END IF;

  RAISE NOTICE 'PPO: prospect_problem_observations created — 3 composite tenant FKs, 4 named indexes, 7 CHECKs, 0 rows; RLS enabled and not forced; exactly 1 policy, scoped to {service_role}; service_role holds exactly SELECT+INSERT; anon, authenticated and PUBLIC hold nothing.';
END
$verify$;

COMMIT;

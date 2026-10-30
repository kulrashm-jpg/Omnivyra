-- PI / Attested engagement identity — the registry relation.
--
-- WHAT THIS STORES. An authorized organization administrator's STATEMENT that
-- one engagement-namespace identity — a `(platform, platform_user_id)` pair
-- exactly as `engagement_authors` holds it — belongs to their own organization.
-- The shared contract is
-- `backend/services/engagementIdentity/attestedIdentityContract.ts`; this table
-- is its storage and nothing else. It is a RECORD, not a proof: an
-- administrator can attest an identity that is not theirs, and this relation
-- claims nothing stronger.
--
-- ─── NEGATIVE EVIDENCE ONLY ───────────────────────────────────────────────
-- An ACTIVE row means "never admit this as a prospect's own statement". It
-- never means the opposite. An identity with no row here is NOT thereby proven
-- external, and an UNREADABLE registry is NOT an empty registry — the single
-- repository fails closed. Nothing in this file produces, implies or enables
-- any assessment of what an identity is worth.
--
-- ─── WHY NOT THE OAUTH TABLES ─────────────────────────────────────────────
-- `engagementThreadService.getOrgAuthorIds` compares
-- `engagement_authors.platform_user_id` (a profile URL, a handle, or an
-- `anon_*` / `extension_author_*` fallback) against
-- `social_accounts.platform_user_id` (an OAuth-native opaque id). Those are
-- different namespaces for every live writer, so the comparison is true only by
-- accident. This relation replaces that accident with an explicit, revocable,
-- tenant-scoped statement, and deliberately carries NO column, key or join
-- reachable from an OAuth table — so no backfill from one has a target to aim
-- at. A postcondition below proves the absence by name, because an absence
-- nobody checks is an absence that returns.
--
-- ─── WHY `platform_user_id` IS NOT CASE-FOLDED, ANYWHERE ──────────────────
-- The value is frequently a profile URL whose path is case-significant, and it
-- can also be an opaque `anon_*` / `extension_author_*` token. The writer of
-- `engagement_authors` (`engagementNormalizationService`) trims and does not
-- fold, so a stored author row holds the identity verbatim. A registry that
-- folded on the way in — or a unique index folded with `lower()` — would hold a
-- string that is not the identity received, would never equality-match the
-- author row it is about, and would silently protect nothing. `platform` IS
-- lower-cased, and is deliberately NOT aliased: `engagement_authors.platform`
-- may legitimately hold 'x' or 'li', and aliasing those to 'twitter' /
-- 'linkedin' would produce exactly the same silent non-match.
--
-- ─── WHY THE TWO ACTOR COLUMNS CARRY NO FOREIGN KEY ───────────────────────
-- DEFECT-008, and this would be its fourth avoidable instance. A `users`
-- reference with `ON DELETE SET NULL` fires a referential UPDATE on this row;
-- PostgreSQL then re-evaluates the row's NOT NULL constraints and every table
-- CHECK, and the user's deletion aborts with 23502 or 23514 — the user becomes
-- undeletable, for a reason no operator can see from the error. The pattern is
-- already live in `ppo_origin_actor`, `source_assertions_origin_actor` and
-- `prospect_lifecycle_origin_actor`; reproducing it a fourth time is not
-- acceptable. `attested_by_user_id` is therefore a MANDATORY actor with NO
-- foreign key, exactly as `identity_verification_attestations.attested_by` is
-- (`20261231000007_identity_verification.sql:92`), and `revoked_by_user_id` is
-- an optional actor on the same terms. Two postconditions make the avoidance
-- falsifiable rather than merely intended: exactly ONE foreign key exists on
-- the table, and NO CHECK constraint references either actor column — so the
-- FK-plus-CHECK combination that causes DEFECT-008 cannot be assembled from
-- either side.
--
-- SAFE TO APPLY. One new table. No existing table, constraint, index, trigger,
-- policy or row is touched, read for migration purposes, or rewritten. There is
-- no backfill: a registry seeded from the OAuth tables would import the exact
-- namespace confusion this relation exists to end.
-- **NOT APPLIED** to any database by the gate that authored it.
--
-- Preflight preconditions ONLY on `companies`, `engagement_authors`, `users`
-- and the house `updated_at` function. `social_accounts` and
-- `user_company_roles` are DELIBERATELY NOT preconditions: this registry must
-- not acquire even a latent dependency on the OAuth mapping it replaces, and a
-- preflight naming either would create one by implication while proving
-- nothing about this table.

BEGIN;

-- ---------------------------------------------------------------------------
-- Preflight — fail closed on a missing prerequisite rather than create a
-- registry whose tenant ownership cannot be enforced.
-- ---------------------------------------------------------------------------
DO $preflight$
BEGIN
  IF to_regclass('public.companies') IS NULL THEN
    RAISE EXCEPTION 'AEI preflight: public.companies is missing — there is no tenant to own an attestation';
  END IF;

  IF to_regclass('public.engagement_authors') IS NULL THEN
    RAISE EXCEPTION 'AEI preflight: public.engagement_authors is missing — there is no identity namespace to attest within';
  END IF;

  IF to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION 'AEI preflight: public.users is missing — an attestation could not name the administrator who made it';
  END IF;

  IF to_regprocedure('public.omnivyra_touch_updated_at()') IS NULL THEN
    RAISE EXCEPTION 'AEI preflight: omnivyra_touch_updated_at() is missing — the house updated_at convention is unavailable';
  END IF;
END
$preflight$;

-- ---------------------------------------------------------------------------
-- attested_engagement_identities — one row per attestation, active or revoked.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.attested_engagement_identities (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- TENANT. An attestation is a statement BY a tenant ABOUT its own identity;
  -- a tenant-less one is unattributable and is never valid. THIS IS THE ONLY
  -- FOREIGN KEY IN THE FILE, and a postcondition below proves it.
  organization_id      uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,

  -- ── THE IDENTITY, IN THE ENGAGEMENT NAMESPACE ───────────────────────────
  -- Lower-cased and trimmed, never aliased. See the file header.
  platform             text NOT NULL,
  -- TRIMMED ONLY. Case is preserved because the value is often a
  -- case-significant profile URL or an opaque token. There is deliberately NO
  -- folded twin and no folded index: a folded key would stop matching the
  -- author row the attestation is about.
  platform_user_id     text NOT NULL,

  -- ── WHAT IS ATTESTED ────────────────────────────────────────────────────
  -- A closed set of one. A second role arrives by migration and by review,
  -- never by a caller inventing a string.
  attested_as          text NOT NULL DEFAULT 'tenant_own',

  -- The administrator's own words, and whatever they chose to attach. The
  -- evidence object is free-form ON PURPOSE — a screenshot reference, a ticket
  -- id, or a basis nobody has thought of yet must never require a migration —
  -- and is size-bounded so the registry cannot become a document store.
  statement            text NOT NULL,
  evidence             jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- ── WHO SAID IT ─────────────────────────────────────────────────────────
  -- Mandatory: an anonymous attestation is not a record of anyone's statement.
  -- NO FOREIGN KEY, deliberately — see DEFECT-008 in the file header.
  attested_by_user_id  uuid NOT NULL,
  attested_at          timestamptz NOT NULL DEFAULT now(),

  -- ── REVOCATION, NOT DELETION ────────────────────────────────────────────
  -- A withdrawn attestation stays on the record. Deleting it would erase the
  -- fact that the tenant once claimed the identity, which is precisely the
  -- history an auditor needs. The three columns move together, and the single
  -- writer never rewrites one that is already set.
  revoked_at           timestamptz,
  revoked_by_user_id   uuid,            -- NO FOREIGN KEY — see the file header.
  revoked_reason       text,

  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  -- The platform is stored exactly as the shared normaliser produces it:
  -- non-blank, trimmed, lower-case. The CHECK is what stops a second,
  -- divergent normaliser being introduced elsewhere and storing 'LinkedIn'
  -- where the author row says 'linkedin'.
  CONSTRAINT aei_platform_shape CHECK (
    length(btrim(platform)) > 0 AND platform = lower(btrim(platform))
  ),

  -- NON-BLANK AND TRIMMED, AND THAT IS ALL. There is deliberately no
  -- `lower()` rule here, in deliberate contrast to the platform above: see the
  -- file header for why folding this column would make the registry match
  -- nothing it is about.
  CONSTRAINT aei_platform_user_id_shape CHECK (
    length(btrim(platform_user_id)) > 0 AND platform_user_id = btrim(platform_user_id)
  ),

  CONSTRAINT aei_attested_as_valid CHECK (attested_as IN ('tenant_own')),

  CONSTRAINT aei_statement_not_blank CHECK (length(btrim(statement)) > 0),

  -- An object, and a small one. A jsonb array or scalar would make
  -- `evidence -> 'x'` silently null for half the rows, and an unbounded value
  -- would turn a registry row into an attachment.
  CONSTRAINT aei_evidence_object CHECK (
    jsonb_typeof(evidence) = 'object' AND pg_column_size(evidence) <= 16384
  ),

  -- Revocation is all-or-nothing, and a revocation states a reason.
  --
  -- NOTE WHAT THIS CHECK DOES NOT NAME: `revoked_by_user_id`. Pairing the
  -- actor column's nullity with `revoked_at` here would read as an improvement
  -- and would in fact re-arm DEFECT-008 — a future `users` reference with ON
  -- DELETE SET NULL would null the actor, this CHECK would then fail on every
  -- revoked row, and the user's deletion would abort with 23514. The actor is
  -- required by the single writer instead, and the postcondition below proves
  -- that no CHECK on this table names either actor column. That is the trade
  -- this relation makes knowingly: a deletable user over a constraint that is
  -- correct only until the day someone adds the obvious foreign key.
  CONSTRAINT aei_revocation_coherent CHECK (
    (revoked_at IS NULL) = (revoked_reason IS NULL)
    AND (revoked_at IS NULL OR length(btrim(revoked_reason)) > 0)
  ),

  -- A revocation cannot precede the statement it withdraws. Equality is
  -- allowed: an attestation made and withdrawn inside one transaction shares
  -- `now()`.
  CONSTRAINT aei_revocation_not_before_attestation CHECK (
    revoked_at IS NULL OR revoked_at >= attested_at
  )
);

-- ── ONE ACTIVE ATTESTATION PER IDENTITY, PER TENANT ─────────────────────────
-- PARTIAL on `revoked_at IS NULL`, and that partiality is load-bearing twice
-- over. A total unique index would make a revoked row block its own
-- re-attestation for ever — an identity could be claimed, withdrawn, and never
-- claimed again — and would also make a second revocation of the same identity
-- unstorable, so the history this table exists to keep could not be written.
--
-- NEVER `lower()`-FOLDED. A folded key would collapse two genuinely different
-- case-significant profile URLs into one row and would reject the second as a
-- replay of the first. A postcondition asserts the absence of `lower(` in the
-- index definition, because this is the single property a well-meaning later
-- edit is most likely to "fix".
--
-- Nothing infers this index: the writer issues a plain insert and reads 23505,
-- so partiality costs no `ON CONFLICT` inference (which would be 42P10 here in
-- any case).
CREATE UNIQUE INDEX IF NOT EXISTS uq_aei_active_identity
  ON public.attested_engagement_identities (organization_id, platform, platform_user_id)
  WHERE revoked_at IS NULL;

-- The read an administrator's registry screen makes: "what has this tenant
-- attested, newest first".
CREATE INDEX IF NOT EXISTS idx_aei_org_attested_at
  ON public.attested_engagement_identities (organization_id, attested_at DESC);

-- ── updated_at, by the house convention ────────────────────────────────────
DO $aei_trigger$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'attested_engagement_identities_touch_updated_at'
       AND tgrelid = 'public.attested_engagement_identities'::regclass
  ) THEN
    CREATE TRIGGER attested_engagement_identities_touch_updated_at
      BEFORE UPDATE ON public.attested_engagement_identities
      FOR EACH ROW EXECUTE FUNCTION public.omnivyra_touch_updated_at();
  END IF;
END
$aei_trigger$;

-- ── RLS ────────────────────────────────────────────────────────────────────
-- Supabase grants ALL on every new public table to `authenticated`, and
-- PostgREST serves it. `20261026000000_close_anon_rls_exposure.sql` revoked the
-- defaults for `anon` but only TRUNCATE for `authenticated`, so without RLS
-- every signed-up user of every tenant could read — and WRITE — this registry.
-- A writable registry is worse than a readable one: inserting a row for a
-- rival's identity would make that rival's statements permanently inadmissible
-- as prospect evidence, and deleting one would re-admit a tenant's own
-- marketing copy as a prospect's words. Both are decisions the platform makes
-- on this table's contents.
--
-- WHAT ACTUALLY CONTROLS THE SERVER CREDENTIAL, PLAINLY. It is NOT the policy
-- below. `service_role` is created BYPASSRLS, so PostgreSQL never evaluates any
-- policy for it — a file that claimed the policy governs the writer's access
-- would be describing an evaluation that does not happen. For the server
-- credential the EFFECTIVE controls are exactly two: the TABLE PRIVILEGES
-- granted immediately below, which bound what the credential can do at all, and
-- the application-layer authorization in the single repository module, which is
-- where the tenant predicate lives. The policy's job is the other one: it is the
-- default-deny backstop for every OTHER role, scoped `TO service_role` so that
-- `anon`, `authenticated` and anything else arriving over PostgREST match no
-- policy and therefore see and write nothing.
--
-- Same posture as `prospect_problem_observations` and `source_records`. ENABLE,
-- never FORCE — FORCE would subject the table OWNER too and break
-- owner-connection realschema suites.
ALTER TABLE public.attested_engagement_identities ENABLE ROW LEVEL SECURITY;

DO $aei_rls$
BEGIN
  -- Converge, do not merely create. A policy with no TO clause applies to
  -- PUBLIC, which is the defect this migration corrects, so a pre-existing
  -- policy whose role set is not exactly {service_role} is replaced.
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'attested_engagement_identities'
       AND policyname = 'attested_engagement_identities_service_role'
       AND roles::text[] <> ARRAY['service_role']
  ) THEN
    DROP POLICY attested_engagement_identities_service_role
      ON public.attested_engagement_identities;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'attested_engagement_identities'
       AND policyname = 'attested_engagement_identities_service_role'
  ) THEN
    CREATE POLICY attested_engagement_identities_service_role
      ON public.attested_engagement_identities
      FOR ALL
      TO service_role
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END
$aei_rls$;

-- ── TABLE PRIVILEGES — DERIVED, NOT ASSUMED ────────────────────────────────
-- The granted set is read off the one module that touches this relation,
-- `backend/services/engagementIdentity/attestedIdentityRepository.ts`, which
-- reaches it over PostgREST as `service_role` and performs exactly three kinds
-- of operation on it: `.insert(row).select(...)`, `.select(...)` and
-- `.update({...}).select(...)`. Hence SELECT, INSERT and UPDATE, and nothing
-- else. UPDATE is in the set BECAUSE A REVOCATION IS AN UPDATE: it withdraws a
-- row by setting `revoked_at` / `revoked_reason` / `revoked_by_user_id` rather
-- than deleting it — which is also exactly why DELETE is NOT granted. There is
-- no RPC and no upsert to account for, and no sequence privilege is needed
-- because the key is a uuid with a `gen_random_uuid()` default rather than an
-- identity column.
--
-- ALL THREE OF `PUBLIC`, `anon` AND `authenticated` ARE NAMED, AND EACH IS
-- LOAD-BEARING. `PUBLIC` is named because it is the inheritance path: a
-- privilege held by PUBLIC is held by every role, which is what makes revoking
-- it the thing that gives the `anon` / `authenticated` revoke its meaning.
-- Revoking from `PUBLIC` ALONE WOULD NOT BE ENOUGH, because it does not remove
-- a privilege granted DIRECTLY to `anon` or `authenticated` — and a managed
-- Supabase project grants exactly that, directly, to those roles. Naming only
-- the two roles would equally leave the PUBLIC grant standing. Same posture as
-- `supabase/migrations/20261211000001_rbac_config_pre_c7_privilege_reduction.sql:56-57`.
--
-- THE ORDER IS DELIBERATE: this REVOKE runs AFTER the `CREATE TABLE` in this
-- same migration, precisely so that whatever a managed project's default
-- privileges conveyed to those roles at creation time is withdrawn here, in the
-- same transaction, rather than left to a later file to notice.
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
REVOKE ALL ON TABLE public.attested_engagement_identities
  FROM PUBLIC, anon, authenticated, authenticator, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.attested_engagement_identities TO service_role;

-- ---------------------------------------------------------------------------
-- Documentation.
-- ---------------------------------------------------------------------------
COMMENT ON TABLE public.attested_engagement_identities IS
  'PI: an administrator''s revocable statement that one engagement-namespace '
  '(platform, platform_user_id) identity belongs to their own organization. A '
  'RECORD, not a proof. NEGATIVE EVIDENCE ONLY: an active row means "never '
  'admit this as a prospect''s own statement", and an absent row proves '
  'nothing. Carries no OAuth column, no token, no join to social_accounts, and '
  'no assessment of any kind.';

COMMENT ON COLUMN public.attested_engagement_identities.platform IS
  'Lower-cased and trimmed by the shared normaliser, and NEVER aliased: '
  'engagement_authors.platform may legitimately hold ''x'' or ''li'', and '
  'aliasing those would store a value that never matches the author row the '
  'attestation is about.';

COMMENT ON COLUMN public.attested_engagement_identities.platform_user_id IS
  'The identity exactly as engagement_authors holds it — TRIMMED ONLY, CASE '
  'PRESERVED. Often a case-significant profile URL or an opaque anon_* token. '
  'There is deliberately no folded twin and no lower()-folded index: folding '
  'would stop the row equality-matching the author row, which is the '
  'registry''s entire purpose. It is NOT an OAuth provider id and is never '
  'compared with one.';

COMMENT ON COLUMN public.attested_engagement_identities.attested_as IS
  'What is attested. A closed set of one (tenant_own); a second role arrives by '
  'migration and review, never by a caller inventing a string.';

COMMENT ON COLUMN public.attested_engagement_identities.evidence IS
  'Free-form object recording the basis the administrator gave. Size-bounded so '
  'a registry row never becomes an attachment. Never parsed into a decision.';

COMMENT ON COLUMN public.attested_engagement_identities.attested_by_user_id IS
  'The administrator who stated it. MANDATORY so an attestation is never '
  'anonymous, and carrying NO FOREIGN KEY to users deliberately: a users '
  'reference with ON DELETE SET NULL would fire a referential UPDATE, '
  'PostgreSQL would re-evaluate this column''s NOT NULL, and deleting the user '
  'would abort with 23502 — DEFECT-008, already live in ppo_origin_actor, '
  'source_assertions_origin_actor and prospect_lifecycle_origin_actor. '
  'Precedent for this safe form: identity_verification_attestations.attested_by.';

COMMENT ON COLUMN public.attested_engagement_identities.revoked_at IS
  'When the attestation was withdrawn. A withdrawn row is KEPT: deleting it '
  'would erase the fact that the tenant once claimed the identity. The active '
  'unique index is partial on this column being NULL, so an identity may be '
  'claimed, withdrawn and claimed again, and every withdrawal is storable.';

COMMENT ON COLUMN public.attested_engagement_identities.revoked_by_user_id IS
  'Who withdrew it. Required by the single writer, and deliberately NOT paired '
  'with revoked_at by a CHECK: such a CHECK would re-arm DEFECT-008 the moment '
  'anyone added the obvious users foreign key, making a revoked row''s actor '
  'undeletable. No FOREIGN KEY, on the same grounds.';

-- ---------------------------------------------------------------------------
-- Postconditions. Each proves ONE property, with its own exception, so a
-- failure says which guarantee is missing rather than that something is wrong.
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE
  v_fk    INT;
  v_idx   INT;
  v_chk   INT;
  v_bad   TEXT;
  v_def   TEXT;
  v_pol   INT;
  v_roles TEXT[];
  v_priv  TEXT[];
  v_open  TEXT;
  v_pub   INT;
  v_rls   BOOLEAN;
  v_force BOOLEAN;
BEGIN
  IF to_regclass('public.attested_engagement_identities') IS NULL THEN
    RAISE EXCEPTION 'AEI postcondition: the table is missing';
  END IF;

  -- 1. EXACTLY ONE foreign key. This is half of the DEFECT-008 guard: with no
  --    users reference, no referential UPDATE can ever re-evaluate a CHECK or
  --    a NOT NULL on this table, so no actor can be made undeletable by it.
  SELECT count(*) INTO v_fk
    FROM pg_constraint
   WHERE conrelid = 'public.attested_engagement_identities'::regclass
     AND contype = 'f';
  IF v_fk <> 1 THEN
    RAISE EXCEPTION 'AEI postcondition: expected exactly 1 foreign key, found % — an actor FK would re-arm DEFECT-008', v_fk;
  END IF;

  -- 2. ...and it is the TENANT key, cascading.
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint con
      JOIN pg_attribute a
        ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
     WHERE con.conrelid = 'public.attested_engagement_identities'::regclass
       AND con.contype = 'f'
       AND a.attname = 'organization_id'
       AND con.confrelid = 'public.companies'::regclass
       AND con.confdeltype = 'c'
       AND array_length(con.conkey, 1) = 1
  ) THEN
    RAISE EXCEPTION 'AEI postcondition: the single FK must be organization_id -> companies ON DELETE CASCADE';
  END IF;

  -- 3. NO OAUTH SURFACE. The registry exists because the OAuth namespace is the
  --    wrong one to compare against; a column reachable from it would give a
  --    backfill something to aim at. `user_id` is matched EXACTLY rather than as
  --    a suffix on purpose: `attested_by_user_id`, `revoked_by_user_id` and
  --    `platform_user_id` are this table's own columns and must survive.
  SELECT string_agg(a.attname, ', ') INTO v_bad
    FROM pg_attribute a
   WHERE a.attrelid = 'public.attested_engagement_identities'::regclass
     AND a.attnum > 0
     AND NOT a.attisdropped
     AND (
       a.attname IN ('access_token', 'refresh_token', 'provider_user_id', 'user_id', 'is_active')
       OR a.attname ~ '(waba|page_access)'
     );
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'AEI postcondition: an OAuth-reachable column is present (%) — this registry must have no such surface', v_bad;
  END IF;

  -- 4. The two named indexes.
  SELECT count(*) INTO v_idx FROM pg_indexes
   WHERE schemaname = 'public'
     AND indexname IN ('uq_aei_active_identity', 'idx_aei_org_attested_at');
  IF v_idx <> 2 THEN
    RAISE EXCEPTION 'AEI postcondition: expected 2 named indexes, found %', v_idx;
  END IF;

  SELECT indexdef INTO v_def FROM pg_indexes
   WHERE schemaname = 'public' AND indexname = 'uq_aei_active_identity';

  -- 5. The active key is PARTIAL. Without the predicate a revoked row would
  --    block its own identity from ever being re-attested.
  IF v_def IS NULL OR v_def !~* 'WHERE[ (]+revoked_at IS NULL' THEN
    RAISE EXCEPTION 'AEI postcondition: uq_aei_active_identity must be PARTIAL on revoked_at IS NULL — found %', coalesce(v_def, 'no index');
  END IF;

  -- 6. ...and it is NOT case-folded. The property most likely to be "fixed" by
  --    a later edit, and the one that would silently break every match.
  IF v_def ILIKE '%lower(%' THEN
    RAISE EXCEPTION 'AEI postcondition: uq_aei_active_identity must not be lower()-folded — a folded key never matches the author row';
  END IF;

  -- 7. The seven invariants that make a stored attestation trustworthy.
  SELECT count(*) INTO v_chk
    FROM pg_constraint
   WHERE conrelid = 'public.attested_engagement_identities'::regclass
     AND contype = 'c'
     AND conname IN ('aei_platform_shape', 'aei_platform_user_id_shape',
                     'aei_attested_as_valid', 'aei_statement_not_blank',
                     'aei_evidence_object', 'aei_revocation_coherent',
                     'aei_revocation_not_before_attestation');
  IF v_chk <> 7 THEN
    RAISE EXCEPTION 'AEI postcondition: expected 7 named CHECK constraints, found %', v_chk;
  END IF;

  -- 8. THE OTHER HALF OF THE DEFECT-008 GUARD, and the falsifiable one. No
  --    CHECK on this table references either actor column, so even if a later
  --    migration added the users foreign key the referential UPDATE would have
  --    no CHECK to fail. Guard 1 and this guard close the trap from both ends.
  SELECT string_agg(DISTINCT con.conname, ', ') INTO v_bad
    FROM pg_constraint con
    JOIN pg_attribute a
      ON a.attrelid = con.conrelid AND a.attnum = ANY (con.conkey)
   WHERE con.conrelid = 'public.attested_engagement_identities'::regclass
     AND con.contype = 'c'
     AND a.attname IN ('attested_by_user_id', 'revoked_by_user_id');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'AEI postcondition: CHECK(s) % reference an actor column — that is the DEFECT-008 trap', v_bad;
  END IF;

  -- 9. The named policy exists, and it is the ONLY policy on the relation. A
  --    second policy is a second way in, and `FOR ALL` policies are OR-ed.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'attested_engagement_identities'
       AND policyname = 'attested_engagement_identities_service_role'
  ) THEN
    RAISE EXCEPTION 'AEI postcondition: the service_role policy is missing';
  END IF;

  SELECT count(*) INTO v_pol FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename = 'attested_engagement_identities';
  IF v_pol <> 1 THEN
    RAISE EXCEPTION 'AEI postcondition: expected exactly 1 policy on the relation, found %', v_pol;
  END IF;

  -- 9a. THE POLICY'S ROLE SET IS EXACTLY {service_role}, AND THE WHOLE ARRAY IS
  --     COMPARED. This replaces an earlier check that asked whether
  --     'authenticated' = ANY (roles), which could not fail: a policy written
  --     without a TO clause has roles = {public}, never {authenticated}, so the
  --     check passed while the policy applied to `authenticated` THROUGH PUBLIC
  --     — the exact condition it was meant to forbid. Comparing the full array
  --     makes a {public} policy FAIL here.
  SELECT roles::text[] INTO v_roles FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename = 'attested_engagement_identities'
     AND policyname = 'attested_engagement_identities_service_role';
  IF v_roles IS DISTINCT FROM ARRAY['service_role'] THEN
    RAISE EXCEPTION 'AEI postcondition: the policy must apply to exactly {service_role}, found % — a policy with no TO clause applies to PUBLIC and therefore reaches anon and authenticated',
      coalesce(array_to_string(v_roles, ','), 'no policy');
  END IF;

  -- 9b. service_role holds EXACTLY the privileges the single repository uses:
  --     INSERT, SELECT, UPDATE (alphabetical) — UPDATE because a revocation
  --     withdraws a row, and no DELETE because it never removes one.
  --
  --     READ FROM pg_class.relacl VIA aclexplode, NOT from
  --     information_schema.role_table_grants. The information_schema view shows
  --     only grants visible to the enabled session role, so it can read falsely
  --     EMPTY and turn this assertion into another one that cannot fail.
  SELECT array_agg(DISTINCT a.privilege_type ORDER BY a.privilege_type)
    INTO v_priv
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(c.relacl) a
    JOIN pg_roles r ON r.oid = a.grantee
   WHERE n.nspname = 'public'
     AND c.relname = 'attested_engagement_identities'
     AND r.rolname = 'service_role';
  IF v_priv IS DISTINCT FROM ARRAY['INSERT', 'SELECT', 'UPDATE'] THEN
    RAISE EXCEPTION 'AEI postcondition: service_role must hold exactly INSERT, SELECT, UPDATE, found %',
      coalesce(array_to_string(v_priv, ','), 'none');
  END IF;

  -- 9c. `anon` and `authenticated` hold NO privilege on the relation. Same
  --     catalog source, for the same reason.
  SELECT string_agg(DISTINCT r.rolname || ':' || a.privilege_type, ', ') INTO v_open
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(c.relacl) a
    JOIN pg_roles r ON r.oid = a.grantee
   WHERE n.nspname = 'public'
     AND c.relname = 'attested_engagement_identities'
     -- `authenticator` is in this list because the REVOKE above names it:
     -- PostgREST connects as that role and then SET ROLEs, so a direct
     -- grant there would be an unaudited path straight to the rows.
     AND r.rolname IN ('anon', 'authenticated', 'authenticator');
  IF v_open IS NOT NULL THEN
    RAISE EXCEPTION 'AEI postcondition: anon/authenticated must hold no privilege on the relation, found %', v_open;
  END IF;

  -- 9d. PUBLIC holds none either. aclexplode reports a PUBLIC grant with
  --     grantee = 0, which joins to no row in pg_roles, so 9c cannot see it and
  --     it is checked separately — a PUBLIC grant is inherited by every role,
  --     including the two above.
  SELECT count(*) INTO v_pub
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(c.relacl) a
   WHERE n.nspname = 'public'
     AND c.relname = 'attested_engagement_identities'
     AND a.grantee = 0;
  IF v_pub <> 0 THEN
    RAISE EXCEPTION 'AEI postcondition: PUBLIC must hold no privilege on the relation, found % grant(s) — PUBLIC is inherited by every role', v_pub;
  END IF;

  -- 9e. RLS is ENABLED and NOT FORCED. Forcing it would subject the table owner
  --     and break the owner-connection realschema suites.
  SELECT c.relrowsecurity, c.relforcerowsecurity INTO v_rls, v_force
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = 'attested_engagement_identities';
  IF v_rls IS NOT TRUE THEN
    RAISE EXCEPTION 'AEI postcondition: row level security must be ENABLED on the relation';
  END IF;
  IF v_force IS NOT FALSE THEN
    RAISE EXCEPTION 'AEI postcondition: row level security must NOT be FORCED — FORCE subjects the table owner and breaks owner-connection suites';
  END IF;

  -- 10. This migration creates no data. There is no backfill, by design.
  IF (SELECT count(*) FROM public.attested_engagement_identities) <> 0 THEN
    RAISE EXCEPTION 'AEI postcondition: the table must be empty on arrival — this registry has no backfill';
  END IF;

  RAISE NOTICE 'AEI: attested_engagement_identities created — 1 tenant FK, 2 indexes, 7 CHECKs, 0 actor FKs, 0 rows; 1 policy scoped to exactly {%}, service_role privileges exactly {%}, anon/authenticated/PUBLIC hold none, RLS enabled=% forced=%.',
    array_to_string(v_roles, ','), array_to_string(v_priv, ','), v_rls, v_force;
END
$verify$;

COMMIT;

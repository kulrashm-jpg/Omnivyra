-- PI R3: prospect_import_review_items — leads HELD for tenant review, NOT imported.
--
-- Version 20270206000000 reserved by Release-controls (virality-83) for this slug.
-- Owner decision R3-A (2026-11-10): a provider-discovered lead (Apollo first)
-- whose evidence matches an existing person only WEAKLY — a first + last name
-- match, a role-shaped address (info@, sales@ ...) or a shared/non-mobile
-- number — is NOT ingested. It is held here until a tenant user chooses
-- IMPORT or SKIP. Rows expire 30 days after creation ("not imported"; the lead
-- can be re-pulled later because nothing was ingested). An exact email or E.164
-- phone match is not held here at all: it is BLOCKED (skipped) before import.
-- NOTHING in R3 merges persons, with or without a decision.
--
-- ─── WHAT BELONGS HERE VERSUS person_duplicate_candidates ─────────────────
-- Two queues with DIFFERENT lifecycles, and neither is a fallback for the other:
--   prospect_import_review_items   a candidate that has NOT been imported: no
--                                  unified_persons row exists for it. Its data
--                                  is the provider's raw record. Decision:
--                                  import or skip. Expires.
--   person_duplicate_candidates    a pair of persons who BOTH exist in PI,
--                                  found after ingestion (LI-4C). Decision:
--                                  retain / dismiss / delete. Never expires.
-- A row type cannot land in both: an item here has no person of its own, and a
-- duplicate candidate requires two. When an item is IMPORTED it leaves this
-- table (deleted by the import path); any duplicate signal on the new person
-- is LI-4C's from then on.
--
-- ─── ERASURE ──────────────────────────────────────────────────────────────
-- One row per (provider record, matched existing person). `matched_person_id`
-- carries a COMPOSITE foreign key to unified_persons (id, company_id) ON DELETE
-- CASCADE, the same shape person_duplicate_candidates uses. Person erasure
-- deletes the unified_persons row (pi_person_erasure_finalize), so every item
-- that names the erased person is deleted with it, and
-- pi_person_erasure_verify's catalog scan of EVERY foreign key into
-- unified_persons covers this table without any erasure function changing.
-- Stated residual: the held raw record describes the CANDIDATE (not yet a
-- person in PI); an item matched to two persons survives the erasure of one
-- of them through its other row.
--
-- ─── RETENTION ────────────────────────────────────────────────────────────
-- expires_at = created_at + 30 days, enforced by the application on BOTH read
-- and write (best-effort DELETE, never required for the read to succeed; no
-- cron, by owner decision). A skip clears raw_record immediately (data
-- minimisation; the row stays only to suppress re-queueing until expiry).
-- ACCEPTED RISK, stated: a tenant that neither reads the list nor runs a new
-- discovery keeps its pending rows past 30 days until it next does either.
-- Rows are bounded by discovery volume (the discovery bounds cap a run at 500
-- results). Queue age and size are readable per tenant through the review API.
--
-- ─── PRIVILEGES ───────────────────────────────────────────────────────────
-- A new table is not covered by the enumerative #23 REVOKE, and a creating
-- role's default privileges can grant clients. So: REVOKE ALL from PUBLIC,
-- anon AND authenticated (named literally), GRANT the four DML privileges to
-- service_role explicitly, RLS on with a service-role-only policy. No view, no
-- matview, no function. Postconditions RAISE.
--
-- ─── ACTOR COLUMN ─────────────────────────────────────────────────────────
-- decided_by records WHO decided: an immutable attribution (GOV-H). It is
-- nullable and carries NO foreign key into public.users (ON DELETE SET NULL
-- would erase the attribution; CASCADE would erase the decision). The writer
-- validates the user's tenant membership at write time. Registered in
-- scripts/migrations/actor-field-registry.json.
--
-- Purely additive. No existing table, column, index, constraint, policy, grant
-- or row is modified.

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.unified_persons') IS NULL OR to_regclass('public.companies') IS NULL THEN
    RAISE EXCEPTION 'PIRI preflight: unified_persons and companies must exist';
  END IF;
  -- The composite FK needs a unique key on unified_persons (id, company_id).
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
     WHERE i.indrelid = 'public.unified_persons'::regclass AND i.indisunique
       AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
              FROM unnest(i.indkey) k JOIN pg_attribute a
                ON a.attrelid = i.indrelid AND a.attnum = k) = ARRAY['company_id', 'id']) THEN
    RAISE EXCEPTION 'PIRI preflight: unified_persons has no unique key on (id, company_id)';
  END IF;
END
$preflight$;

CREATE TABLE IF NOT EXISTS public.prospect_import_review_items (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid        NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  source              text        NOT NULL,
  provider_record_id  text        NOT NULL,
  matched_person_id   uuid        NOT NULL,
  reason              text        NOT NULL,
  raw_record          jsonb,
  status              text        NOT NULL DEFAULT 'pending',
  created_at          timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  decided_by          uuid,
  decided_at          timestamptz,
  CONSTRAINT piri_source_key CHECK (source ~ '^[a-z][a-z0-9_]{0,39}$'),
  CONSTRAINT piri_provider_record_id_len CHECK (length(btrim(provider_record_id)) BETWEEN 1 AND 200),
  CONSTRAINT piri_reason_valid CHECK (reason IN ('name_match', 'role_contact', 'shared_phone')),
  CONSTRAINT piri_status_valid CHECK (status IN ('pending', 'skipped')),
  -- A pending item holds the record and no decision (no time, no actor); a
  -- skipped one holds a decision time and NO record (minimisation). A skipped
  -- row may have a NULL decided_by (a system action), so the actor is
  -- constrained only on the pending side.
  CONSTRAINT piri_decision_coherent CHECK (
    (status = 'pending' AND decided_at IS NULL AND decided_by IS NULL AND raw_record IS NOT NULL)
    OR (status = 'skipped' AND decided_at IS NOT NULL AND raw_record IS NULL)),
  CONSTRAINT piri_expiry_after_creation CHECK (expires_at > created_at),
  CONSTRAINT piri_matched_person_fk FOREIGN KEY (matched_person_id, organization_id)
    REFERENCES public.unified_persons (id, company_id) ON DELETE CASCADE,
  CONSTRAINT piri_one_row_per_match UNIQUE (organization_id, source, provider_record_id, matched_person_id)
);

CREATE INDEX IF NOT EXISTS ix_piri_tenant_status_expiry
  ON public.prospect_import_review_items (organization_id, status, expires_at);
CREATE INDEX IF NOT EXISTS ix_piri_matched_person
  ON public.prospect_import_review_items (matched_person_id);

ALTER TABLE public.prospect_import_review_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS piri_service_role ON public.prospect_import_review_items;
CREATE POLICY piri_service_role ON public.prospect_import_review_items
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON TABLE public.prospect_import_review_items FROM PUBLIC;
DO $grants$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.prospect_import_review_items FROM %I', r);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.prospect_import_review_items TO service_role;
  END IF;
END
$grants$;

COMMENT ON TABLE public.prospect_import_review_items IS
  'PI R3: provider-discovered leads HELD (not imported) for tenant review, import or skip. '
  'One row per (provider record, matched existing person). Expires after 30 days. Never merges. '
  'Erasure: composite FK to unified_persons ON DELETE CASCADE.';

-- ─── POSTCONDITIONS (each RAISEs; the input that trips it is named) ─────────
DO $verify$
DECLARE
  r text;
  p text;
  v_privs text[] := ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
  v_col_privs text[] := ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'];
BEGIN
  -- MAINTAIN exists only on PostgreSQL 17+; asking about it earlier errors.
  IF current_setting('server_version_num')::int >= 170000 THEN
    -- array_append, not `||`: with an untyped literal, `text[] || 'MAINTAIN'`
    -- resolves to array || array and fails as a malformed array literal.
    v_privs := array_append(v_privs, 'MAINTAIN');
  END IF;

  -- (1) No client privilege, table- OR column-level.
  --     Trips on: any GRANT ... ON prospect_import_review_items TO anon/authenticated,
  --     including a column-only GRANT SELECT (col) that has_table_privilege cannot see,
  --     or a default ACL of the creating role that the REVOKE did not remove.
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r);
    FOREACH p IN ARRAY v_privs LOOP
      IF has_table_privilege(r, 'public.prospect_import_review_items', p) THEN
        RAISE EXCEPTION 'PIRI postcondition: client role % holds % on prospect_import_review_items', r, p;
      END IF;
    END LOOP;
    FOREACH p IN ARRAY v_col_privs LOOP
      IF has_any_column_privilege(r, 'public.prospect_import_review_items', p) THEN
        RAISE EXCEPTION 'PIRI postcondition: client role % holds column-level % on prospect_import_review_items', r, p;
      END IF;
    END LOOP;
  END LOOP;

  -- (2) service_role can do the four DML operations the application needs.
  --     Trips on: the GRANT being removed or reduced. Deliberately NOT an
  --     "only these" check: hosted Supabase gives service_role ALL on a new
  --     table, which would make such a check pass in a sandbox and RAISE at apply.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    FOREACH p IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
      IF NOT has_table_privilege('service_role', 'public.prospect_import_review_items', p) THEN
        RAISE EXCEPTION 'PIRI postcondition: service_role lacks % on prospect_import_review_items', p;
      END IF;
    END LOOP;
  END IF;

  -- (3) RLS is on. Trips on: the ENABLE line removed, or RLS disabled afterwards.
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.prospect_import_review_items'::regclass) THEN
    RAISE EXCEPTION 'PIRI postcondition: RLS is not enabled on prospect_import_review_items';
  END IF;

  -- (4) The ONLY policy is service-role-only. Trips on: any additional policy, or
  --     the policy widened to another role (e.g. TO authenticated or TO public).
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'prospect_import_review_items'
       AND (policyname <> 'piri_service_role' OR roles <> ARRAY['service_role']::name[])) THEN
    RAISE EXCEPTION 'PIRI postcondition: a non-service-role policy exists on prospect_import_review_items';
  END IF;

  -- (5) Erasure reaches this table: the person FK is ON DELETE CASCADE ('c').
  --     Trips on: the FK declared NO ACTION / SET NULL / RESTRICT, or missing.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'piri_matched_person_fk' AND contype = 'f' AND confdeltype = 'c'
       AND conrelid = 'public.prospect_import_review_items'::regclass
       AND confrelid = 'public.unified_persons'::regclass) THEN
    RAISE EXCEPTION 'PIRI postcondition: piri_matched_person_fk must CASCADE from unified_persons';
  END IF;

  -- (5b) SHAPE: the named constraints exist. CREATE TABLE IF NOT EXISTS would
  --      silently keep a pre-existing table of the same name and another shape.
  --      Trips on: any of these constraints missing (or renamed).
  FOREACH p IN ARRAY ARRAY['piri_decision_coherent', 'piri_one_row_per_match', 'piri_status_valid',
                           'piri_reason_valid', 'piri_source_key', 'piri_expiry_after_creation'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = p AND conrelid = 'public.prospect_import_review_items'::regclass) THEN
      RAISE EXCEPTION 'PIRI postcondition: constraint % is missing on prospect_import_review_items', p;
    END IF;
  END LOOP;

  -- (6) decided_by carries NO foreign key into users (GOV-H immutable actor) and is nullable.
  --     Trips on: any FK on decided_by, or decided_by declared NOT NULL.
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
     WHERE c.conrelid = 'public.prospect_import_review_items'::regclass
       AND c.contype = 'f' AND a.attname = 'decided_by') THEN
    RAISE EXCEPTION 'PIRI postcondition: decided_by must not carry a foreign key';
  END IF;
  IF (SELECT attnotnull FROM pg_attribute
       WHERE attrelid = 'public.prospect_import_review_items'::regclass AND attname = 'decided_by') THEN
    RAISE EXCEPTION 'PIRI postcondition: decided_by must be nullable';
  END IF;
END
$verify$;

COMMIT;

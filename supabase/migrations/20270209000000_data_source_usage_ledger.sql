-- 20270209000000 data_source_usage_ledger (reserved by virality-83, 2026-11-10)
--
-- PI mode B / owner "Data sources & usage" (2026-11-10): every data source must
-- be visible to the tenant, so they can reconcile against the vendor's own usage
-- page and see the value they got: per vendor, per user, per period, per run.
-- The view READS the existing ledgers; this migration only adds what they do not
-- hold yet. No parallel ledger, no backfill.
--
-- ─── 1. ADDITIVE NULLABLE COLUMNS ON TWO APPLIED TABLES ───────────────────
-- APPLIED STATUS (virality-83 C1, production catalogue, owner-approved,
-- 2026-11-10): CONFIRMED. Both tables EXIST in public (relkind r), with no
-- triggers or rules. prospect_enrichment_attempts has none of the new columns.
-- prospect_discovery_attempts ALREADY has provider_cost_units integer NULL and
-- provider_cost_state text NOT NULL default 'unknown', with cost_units_consistent
-- (state <> 'unknown' OR units IS NULL), cost_units_nonnegative,
-- cost_state_valid, and ingested_within_observed (ingested <= observed). This
-- file changes none of those; pda_screening_within_observed coexists with
-- ingested_within_observed, and the rollback never drops the existing ones.
-- The usage writer never writes discovery provider_cost_units: the existing
-- page writer owns it, together with provider_cost_state.
-- This version itself: never applied anywhere.
-- Adding a NULLABLE column without a default is a catalog-only change on PG11+
-- (no table rewrite); a new column inherits the table's ACL, so no grant moves.
--
-- prospect_enrichment_attempts:
--   provider_cost_units  integer  what the VENDOR billed for this call, in the
--                                 vendor's own unit (e.g. Apollo credits). The
--                                 SAME name and meaning as the column
--                                 prospect_discovery_attempts already has, so one
--                                 fact has one name across both ledgers (PI
--                                 review (a)).
--   funding              text     'tenant' (the tenant's own key; the vendor
--                                 bills the tenant) | 'platform' (Omnivyra's
--                                 central key; charged in Omnivyra credits).
--   credits_charged      integer  Omnivyra credits CONFIRMED for this call.
--   initiated_by         uuid     the user who started it (GOV-H actor: no FK,
--                                 writer-validated; NULL for a system action).
-- prospect_discovery_attempts: the same funding, credits_charged, initiated_by
--   (it already has provider_cost_units), plus R3's screening counts, which
--   today exist only in the run's response:
--   results_skipped_duplicate, results_held_for_review, results_probe_unknown.
--
-- provider_cost_units and credits_charged are DIFFERENT facts and are NOT tied
-- by a CHECK: when the vendor answered but persistence failed, the vendor billed
-- us (units > 0) and the tenant was not charged (credits 0). That divergence is
-- the reason both exist.
--
-- ─── 2. prospect_capture_runs (NEW, small) ────────────────────────────────
-- Sales Navigator capture totals, one row per Outreach capture command.
-- PI review ruling: NOT prospect_discovery_attempts (its bounds and call-state
-- CHECKs would reject or falsify a push with no provider call). Counts and ids
-- only: no person data (refused_reason is a CODE, enforced by CHECK).
-- Key (organization_id, command_id). Outreach contract
-- EXTENSION-1.5.0-CONTRACT.md §5.3: "capture command_id is single-use; a repeat
-- is a retry of the same batch". The writer REPLACES on conflict, but only with
-- a COMPLETE run, so a failed retry never overwrites good totals.

BEGIN;

ALTER TABLE public.prospect_enrichment_attempts
  ADD COLUMN IF NOT EXISTS provider_cost_units integer,
  ADD COLUMN IF NOT EXISTS funding text,
  ADD COLUMN IF NOT EXISTS credits_charged integer,
  ADD COLUMN IF NOT EXISTS initiated_by uuid;

ALTER TABLE public.prospect_discovery_attempts
  ADD COLUMN IF NOT EXISTS funding text,
  ADD COLUMN IF NOT EXISTS credits_charged integer,
  ADD COLUMN IF NOT EXISTS initiated_by uuid,
  ADD COLUMN IF NOT EXISTS results_skipped_duplicate integer,
  ADD COLUMN IF NOT EXISTS results_held_for_review integer,
  ADD COLUMN IF NOT EXISTS results_probe_unknown integer;

DO $checks$
BEGIN
  -- NOT VALID (PI review, 2026-11-11): both attempt tables are applied and grow
  -- per call, and their row counts are unmeasured. A plain ADD CONSTRAINT would
  -- scan every existing row while this transaction holds ACCESS EXCLUSIVE (taken
  -- by ADD COLUMN and held to COMMIT), stalling writes during a production apply.
  -- NOT VALID enforces on every NEW or UPDATED row immediately and scans nothing.
  -- The VALIDATE step is a SEPARATE migration (20270209000001), run in its own transaction under
  -- SHARE UPDATE EXCLUSIVE (writes continue). Every existing row passes: the new
  -- columns are NULL and the coalesce sums reduce to ingested_within_observed.
  -- enrichment attempts
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pea_funding_valid') THEN
    ALTER TABLE public.prospect_enrichment_attempts ADD CONSTRAINT pea_funding_valid
      CHECK (funding IS NULL OR funding IN ('tenant', 'platform')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pea_cost_units_nonnegative') THEN
    ALTER TABLE public.prospect_enrichment_attempts ADD CONSTRAINT pea_cost_units_nonnegative
      CHECK (provider_cost_units IS NULL OR provider_cost_units >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pea_credits_nonnegative') THEN
    ALTER TABLE public.prospect_enrichment_attempts ADD CONSTRAINT pea_credits_nonnegative
      CHECK (credits_charged IS NULL OR credits_charged >= 0) NOT VALID;
  END IF;
  -- Own key => never Omnivyra credits. NULL-tolerant for existing rows.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pea_tenant_funding_uncharged') THEN
    ALTER TABLE public.prospect_enrichment_attempts ADD CONSTRAINT pea_tenant_funding_uncharged
      CHECK (funding IS DISTINCT FROM 'tenant' OR coalesce(credits_charged, 0) = 0) NOT VALID;
  END IF;
  -- discovery attempts
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pda_funding_valid') THEN
    ALTER TABLE public.prospect_discovery_attempts ADD CONSTRAINT pda_funding_valid
      CHECK (funding IS NULL OR funding IN ('tenant', 'platform')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pda_credits_nonnegative') THEN
    ALTER TABLE public.prospect_discovery_attempts ADD CONSTRAINT pda_credits_nonnegative
      CHECK (credits_charged IS NULL OR credits_charged >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pda_tenant_funding_uncharged') THEN
    ALTER TABLE public.prospect_discovery_attempts ADD CONSTRAINT pda_tenant_funding_uncharged
      CHECK (funding IS DISTINCT FROM 'tenant' OR coalesce(credits_charged, 0) = 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pda_screening_nonnegative') THEN
    ALTER TABLE public.prospect_discovery_attempts ADD CONSTRAINT pda_screening_nonnegative
      CHECK (coalesce(results_skipped_duplicate, 0) >= 0 AND coalesce(results_held_for_review, 0) >= 0
             AND coalesce(results_probe_unknown, 0) >= 0) NOT VALID;
  END IF;
  -- R3: everything the screen decided cannot exceed what was observed. coalesce
  -- lets an existing row (NULLs) pass while a new row cannot lie (PI review (b)).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pda_screening_within_observed') THEN
    ALTER TABLE public.prospect_discovery_attempts ADD CONSTRAINT pda_screening_within_observed
      CHECK (results_ingested + coalesce(results_skipped_duplicate, 0) + coalesce(results_held_for_review, 0)
             + coalesce(results_probe_unknown, 0) <= results_observed) NOT VALID;
  END IF;
END
$checks$;

CREATE TABLE IF NOT EXISTS public.prospect_capture_runs (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid        NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  provider           text        NOT NULL,
  command_id         text        NOT NULL,
  initiated_by       uuid,
  status             text        NOT NULL,
  received           integer     NOT NULL DEFAULT 0,
  accepted           integer     NOT NULL DEFAULT 0,
  rejected           integer     NOT NULL DEFAULT 0,
  created            integer     NOT NULL DEFAULT 0,
  updated            integer     NOT NULL DEFAULT 0,
  unchanged          integer     NOT NULL DEFAULT 0,
  duplicates_parked  integer     NOT NULL DEFAULT 0,
  refused_reason     text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  completed_at       timestamptz,
  CONSTRAINT pcr_provider_key CHECK (provider ~ '^[a-z][a-z0-9_]{0,39}$'),
  CONSTRAINT pcr_command_id_len CHECK (length(btrim(command_id)) BETWEEN 1 AND 200),
  CONSTRAINT pcr_status_valid CHECK (status IN ('complete', 'refused', 'failed')),
  CONSTRAINT pcr_counts_nonnegative CHECK (received >= 0 AND accepted >= 0 AND rejected >= 0 AND created >= 0
    AND updated >= 0 AND unchanged >= 0 AND duplicates_parked >= 0),
  CONSTRAINT pcr_accepted_within_received CHECK (accepted + rejected <= received),
  CONSTRAINT pcr_outcomes_within_accepted CHECK (created + updated + unchanged + duplicates_parked <= accepted),
  -- A refused batch carries a reason CODE and no outcomes; a non-refused one carries no reason.
  CONSTRAINT pcr_refusal_coherent CHECK (
    (status = 'refused' AND refused_reason IS NOT NULL AND accepted = 0)
    OR (status <> 'refused' AND refused_reason IS NULL)),
  CONSTRAINT pcr_refused_reason_code CHECK (refused_reason IS NULL OR refused_reason ~ '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT pcr_complete_has_time CHECK ((status = 'complete') = (completed_at IS NOT NULL)),
  CONSTRAINT pcr_one_row_per_command UNIQUE (organization_id, command_id)
);

CREATE INDEX IF NOT EXISTS ix_pcr_tenant_time ON public.prospect_capture_runs (organization_id, created_at DESC);

ALTER TABLE public.prospect_capture_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pcr_service_role ON public.prospect_capture_runs;
CREATE POLICY pcr_service_role ON public.prospect_capture_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON TABLE public.prospect_capture_runs FROM PUBLIC;
DO $grants$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.prospect_capture_runs FROM %I', r);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.prospect_capture_runs TO service_role;
  END IF;
END
$grants$;

-- POSTCONDITIONS: as in 20270206000000, adapted (each RAISEs; trip input named).
DO $verify$
DECLARE
  r text; p text;
  v_privs text[] := ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
  v_col_privs text[] := ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'];
BEGIN
  IF current_setting('server_version_num')::int >= 170000 THEN v_privs := array_append(v_privs, 'MAINTAIN'); END IF;
  -- (1) no client privilege on the new table (table- or column-level). Trips on any client GRANT.
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r);
    FOREACH p IN ARRAY v_privs LOOP
      IF has_table_privilege(r, 'public.prospect_capture_runs', p) THEN
        RAISE EXCEPTION 'PCR postcondition: client role % holds % on prospect_capture_runs', r, p; END IF;
    END LOOP;
    FOREACH p IN ARRAY v_col_privs LOOP
      IF has_any_column_privilege(r, 'public.prospect_capture_runs', p) THEN
        RAISE EXCEPTION 'PCR postcondition: client role % holds column-level % on prospect_capture_runs', r, p; END IF;
    END LOOP;
  END LOOP;
  -- (2) service_role has the four it needs. Trips on the GRANT removed.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    FOREACH p IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
      IF NOT has_table_privilege('service_role', 'public.prospect_capture_runs', p) THEN
        RAISE EXCEPTION 'PCR postcondition: service_role lacks % on prospect_capture_runs', p; END IF;
    END LOOP;
  END IF;
  -- (3) RLS on, (4) only the service-role policy.
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.prospect_capture_runs'::regclass) THEN
    RAISE EXCEPTION 'PCR postcondition: RLS is not enabled on prospect_capture_runs'; END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'prospect_capture_runs'
             AND (policyname <> 'pcr_service_role' OR roles <> ARRAY['service_role']::name[])) THEN
    RAISE EXCEPTION 'PCR postcondition: a non-service-role policy exists on prospect_capture_runs'; END IF;
  -- (5) shape: every named constraint exists (IF NOT EXISTS could keep another shape).
  FOREACH p IN ARRAY ARRAY['pcr_status_valid', 'pcr_counts_nonnegative', 'pcr_accepted_within_received',
      'pcr_outcomes_within_accepted', 'pcr_refusal_coherent', 'pcr_refused_reason_code', 'pcr_complete_has_time',
      'pcr_one_row_per_command'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = p AND conrelid = 'public.prospect_capture_runs'::regclass) THEN
      RAISE EXCEPTION 'PCR postcondition: constraint % is missing', p; END IF;
  END LOOP;
  -- (6) the new attempt-table constraints exist (NOT VALID here; validated by the
  --     follow-on VALIDATE migration, whose postcondition checks convalidated).
  FOREACH p IN ARRAY ARRAY['pea_funding_valid', 'pea_cost_units_nonnegative', 'pea_credits_nonnegative',
      'pea_tenant_funding_uncharged', 'pda_funding_valid', 'pda_credits_nonnegative', 'pda_tenant_funding_uncharged',
      'pda_screening_nonnegative', 'pda_screening_within_observed'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = p) THEN
      RAISE EXCEPTION 'usage postcondition: constraint % is missing', p; END IF;
  END LOOP;
  -- (7) initiated_by: no FK anywhere (GOV-H). Trips on any FK on those columns.
  IF EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
             WHERE c.contype = 'f' AND a.attname = 'initiated_by'
               AND c.conrelid IN ('public.prospect_enrichment_attempts'::regclass, 'public.prospect_discovery_attempts'::regclass,
                                  'public.prospect_capture_runs'::regclass)) THEN
    RAISE EXCEPTION 'usage postcondition: initiated_by must not carry a foreign key'; END IF;
END
$verify$;

COMMIT;

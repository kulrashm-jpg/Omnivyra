-- ============================================================================
-- customer_readiness_snapshots — SECURED (supersedes 20260723000000 for deployment)
--
-- WHAT THIS ADDS
--   The daily Customer Readiness history table (identical definition to
--   20260723000000_customer_readiness_snapshots.sql) PLUS the access controls that
--   file never had: row level security, an explicit service-role policy, and no
--   table privileges for anon / authenticated.
--
-- WHY (which code paths write/read it)
--   writer  backend/services/customerReadinessSnapshotService.ts (defaultWriter.upsertDaily),
--           run daily by backend/jobs/readinessSnapshotJob.ts from backend/scheduler/cron.ts.
--   readers backend/services/customerEvolutionService.ts (loadReadinessHistory) and the
--           customer-operations services, served ONLY through
--           pages/api/super-admin/customer-readiness.ts and customer-operations.ts
--           (SUPER_ADMIN_DASHBOARD_VIEW). Every path uses the service-role client
--           (backend/db/supabaseClient). Nothing reads it from the browser.
--
-- WHAT FAILS IF ABSENT
--   The daily job's upsert errors (caught, counted as csa.readiness_snapshot.failures)
--   and the evolution engine has no history (every company resolves to UNKNOWN).
--
-- WHY NOT 20260723000000 AS WRITTEN
--   It creates a tenant-keyed table with RLS OFF and no grant restrictions. Under the
--   current default privileges (20261026000000) every new public table is granted to
--   authenticated, so any signed-in user could read every tenant's readiness through
--   PostgREST. This file is the one to apply. It is safe whether or not 20260723000000
--   was ever applied: the table is created only if absent, its shape is then asserted,
--   and the access controls are applied either way.
--
-- ACCESS MODEL
--   service_role only (it bypasses RLS; the policy documents intent). No tenant-facing
--   read policy is created because no tenant-facing reader exists; adding one later is
--   an explicit, reviewed change.
--
-- APPLICATION
--   *** DO NOT RUN `supabase db push`. *** Apply by hand per docs/migration-discipline.md.
--   This file opens its own transaction; any failed assertion rolls everything back.
--   Record the ledger row only as a separate, approved step after verification.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.customer_readiness_snapshots (
  snapshot_id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               uuid        NOT NULL,
  taken_at                 timestamptz NOT NULL DEFAULT now(),
  snapshot_date            date        NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,

  tenant_status            text        NOT NULL,
  overall_readiness_score  integer     NOT NULL,
  readiness_bucket         text        NOT NULL,

  priority_score           integer     NOT NULL DEFAULT 0,
  priority_tier            text        NOT NULL,

  opportunity_count        integer     NOT NULL DEFAULT 0,

  company_profile_ready    text        NOT NULL,
  website_ready            text        NOT NULL,
  ga_ready                 text        NOT NULL,
  gsc_ready                text        NOT NULL,
  social_ready             text        NOT NULL,
  community_ready          text        NOT NULL,
  team_ready               text        NOT NULL,
  billing_ready            text        NOT NULL,

  snapshot_version         text        NOT NULL DEFAULT 'readiness-snapshot-v1'
);

-- Shape guard: CREATE TABLE IF NOT EXISTS is a no-op on an existing table, so assert
-- the columns the writer and readers use rather than assume them.
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(c, ', ') INTO missing
    FROM unnest(ARRAY['snapshot_id','company_id','taken_at','snapshot_date','tenant_status',
                      'overall_readiness_score','readiness_bucket','priority_score','priority_tier',
                      'opportunity_count','company_profile_ready','website_ready','ga_ready','gsc_ready',
                      'social_ready','community_ready','team_ready','billing_ready','snapshot_version']) AS c
   WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_schema = 'public' AND table_name = 'customer_readiness_snapshots' AND column_name = c);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'customer_readiness_snapshots exists with an unexpected shape; missing columns: %', missing;
  END IF;
END $$;

-- One snapshot per company per day: the writer's ON CONFLICT (company_id, snapshot_date) target.
CREATE UNIQUE INDEX IF NOT EXISTS idx_crs_company_day
  ON public.customer_readiness_snapshots (company_id, snapshot_date);

-- "Latest snapshots per company" reads for the evolution engine.
CREATE INDEX IF NOT EXISTS idx_crs_company_taken
  ON public.customer_readiness_snapshots (company_id, taken_at DESC);

ALTER TABLE public.customer_readiness_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_readiness_snapshots_service_role ON public.customer_readiness_snapshots;
CREATE POLICY customer_readiness_snapshots_service_role ON public.customer_readiness_snapshots
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- No client-role access at all (default privileges grant authenticated ALL on new tables).
REVOKE ALL ON TABLE public.customer_readiness_snapshots FROM PUBLIC, anon, authenticated;
-- The writer needs INSERT (+ SELECT for RETURNING); readers need SELECT.
GRANT SELECT, INSERT ON TABLE public.customer_readiness_snapshots TO service_role;

COMMENT ON TABLE public.customer_readiness_snapshots IS
  'CSA-002 daily Customer Readiness history (one row per company per UTC day). Service-role only: written by readinessSnapshotJob, read by the super-admin customer-operations services.';

-- Postconditions: the transaction commits only in the intended end state.
DO $$
DECLARE
  rel oid := 'public.customer_readiness_snapshots'::regclass;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = rel) THEN
    RAISE EXCEPTION 'postcondition: RLS is not enabled on customer_readiness_snapshots';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = rel AND polname = 'customer_readiness_snapshots_service_role') THEN
    RAISE EXCEPTION 'postcondition: service-role policy missing';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = rel
              AND EXISTS (SELECT 1 FROM unnest(p.polroles) r WHERE r = 0 OR r IN ('anon'::regrole, 'authenticated'::regrole))) THEN
    RAISE EXCEPTION 'postcondition: a policy applies to PUBLIC/anon/authenticated';
  END IF;
  IF has_table_privilege('anon', rel, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR has_table_privilege('authenticated', rel, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
    RAISE EXCEPTION 'postcondition: anon/authenticated still hold a privilege on customer_readiness_snapshots';
  END IF;
  IF NOT (has_table_privilege('service_role', rel, 'SELECT') AND has_table_privilege('service_role', rel, 'INSERT')) THEN
    RAISE EXCEPTION 'postcondition: service_role lacks SELECT/INSERT on customer_readiness_snapshots';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                  WHERE i.indrelid = rel AND c.relname = 'idx_crs_company_day' AND i.indisunique AND i.indisvalid) THEN
    RAISE EXCEPTION 'postcondition: unique index idx_crs_company_day missing or invalid (writer ON CONFLICT target)';
  END IF;
END $$;

COMMIT;

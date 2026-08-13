-- W5 — canonical person spine tenant-integrity hardening.
--
-- W4 closed three cross-tenant holes and its audit then found the class was far
-- wider: `unified_persons` had 14 inbound foreign keys in `public` and only 2
-- carried the tenant. The other 12 let a row owned by tenant A reference a
-- person owned by tenant B. None is violated today; this migration makes that
-- structurally impossible before any phase ingests real external prospects.
--
-- The pattern is the one established by `canonical_leads -> canonical_users`
-- (20260409) and reused by W2 and W4:
--
--     (person_col, tenant_col) REFERENCES unified_persons (id, company_id)
--
-- MATCH SIMPLE (the default) means the constraint is skipped when either column
-- is NULL, so unlinked rows stay legal exactly as they are today.
--
-- DELETE SEMANTICS. Nine of these edges are ON DELETE SET NULL. A bare SET NULL
-- on a composite key nulls EVERY column, which would wipe the tenant off a
-- surviving row — and fail outright where the tenant is NOT NULL. PostgreSQL 15
-- added `ON DELETE SET NULL (column_list)`; production is 17.6, so each edge
-- nulls only the person column and leaves the tenant intact. That preserves the
-- current behaviour precisely rather than downgrading it to CASCADE or RESTRICT
-- to make the migration compile.
--
-- NOT CONVERTED, deliberately (see the W5 report for the full reasoning):
--   users          - `company_id` is NULL on 99 of 131 rows; tenancy actually
--                    lives in `user_company_roles`. A composite FK here would
--                    encode a tenant claim the schema does not make.
--   engagement_identity_candidates - has no tenant column at all.
--
-- Rollback: supabase/migrations/rollbacks/w5_person_spine_tenant_integrity_rollback.sql

BEGIN;

-- ---------------------------------------------------------------------------
-- Preflight. Fail closed: refuse to run if the referenced key is missing or if
-- any edge already holds a cross-tenant row. W5 hardens; it never repairs data.
-- ---------------------------------------------------------------------------
DO $preflight$
DECLARE
  v_edge   RECORD;
  v_bad    BIGINT;
  v_report TEXT := '';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'unified_persons'
      AND indexname = 'uq_unified_persons_id_company'
  ) THEN
    RAISE EXCEPTION 'W5 preflight: uq_unified_persons_id_company is missing; '
                    'the composite foreign keys cannot reference (id, company_id).';
  END IF;

  FOR v_edge IN
    SELECT * FROM (VALUES
      ('canonical_leads',          'unified_person_id', 'company_id'),
      ('canonical_revenue_events', 'unified_person_id', 'company_id'),
      ('canonical_users',          'unified_person_id', 'company_id'),
      ('contacts',                 'unified_person_id', 'organization_id'),
      ('engagement_threads',       'unified_person_id', 'organization_id'),
      ('expected_event_instances', 'unified_person_id', 'company_id'),
      ('leads',                    'unified_person_id', 'company_id'),
      ('unified_touchpoints',      'unified_person_id', 'company_id'),
      ('visitor_sessions',         'unified_person_id', 'company_id'),
      ('unified_person_merges',    'winner_person_id',  'company_id'),
      ('unified_person_merges',    'loser_person_id',   'company_id')
    ) AS e(tbl, person_col, tenant_col)
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM public.%I s JOIN public.unified_persons p ON p.id = s.%I
         WHERE s.%I IS NOT NULL AND s.%I IS DISTINCT FROM p.company_id',
      v_edge.tbl, v_edge.person_col, v_edge.tenant_col, v_edge.tenant_col)
    INTO v_bad;

    IF v_bad > 0 THEN
      v_report := v_report || format('%s.%s: %s cross-tenant row(s); ',
                                     v_edge.tbl, v_edge.person_col, v_bad);
    END IF;
  END LOOP;

  IF v_report <> '' THEN
    RAISE EXCEPTION 'W5 preflight: existing cross-tenant data blocks this migration -> %', v_report;
  END IF;
END
$preflight$;

-- ---------------------------------------------------------------------------
-- Conversions. Each drops the simple FK and adds the tenant-safe composite.
-- Idempotent: a re-run finds the composite already present and does nothing.
-- ---------------------------------------------------------------------------
DO $convert$
DECLARE
  v_edge RECORD;
BEGIN
  FOR v_edge IN
    SELECT * FROM (VALUES
      ('canonical_leads',          'unified_person_id', 'company_id',
       'canonical_leads_unified_person_id_fkey',          'canonical_leads_person_tenant_fk',
       'SET NULL (unified_person_id)'),
      ('canonical_revenue_events', 'unified_person_id', 'company_id',
       'canonical_revenue_events_unified_person_id_fkey', 'canonical_revenue_events_person_tenant_fk',
       'SET NULL (unified_person_id)'),
      ('canonical_users',          'unified_person_id', 'company_id',
       'canonical_users_unified_person_id_fkey',          'canonical_users_person_tenant_fk',
       'SET NULL (unified_person_id)'),
      ('contacts',                 'unified_person_id', 'organization_id',
       'contacts_unified_person_id_fkey',                 'contacts_person_tenant_fk',
       'SET NULL (unified_person_id)'),
      ('engagement_threads',       'unified_person_id', 'organization_id',
       'engagement_threads_unified_person_id_fkey',       'engagement_threads_person_tenant_fk',
       'SET NULL (unified_person_id)'),
      ('expected_event_instances', 'unified_person_id', 'company_id',
       'expected_event_instances_unified_person_id_fkey', 'expected_event_instances_person_tenant_fk',
       'SET NULL (unified_person_id)'),
      ('leads',                    'unified_person_id', 'company_id',
       'fk_leads_unified_person',                         'leads_person_tenant_fk',
       'SET NULL (unified_person_id)'),
      ('unified_touchpoints',      'unified_person_id', 'company_id',
       'unified_touchpoints_unified_person_id_fkey',      'unified_touchpoints_person_tenant_fk',
       'SET NULL (unified_person_id)'),
      ('visitor_sessions',         'unified_person_id', 'company_id',
       'visitor_sessions_unified_person_id_fkey',         'visitor_sessions_person_tenant_fk',
       'SET NULL (unified_person_id)'),
      -- A merge record names two persons. Both must belong to the tenant that
      -- owns the record: a merge spanning tenants is precisely the identity
      -- corruption this phase exists to prevent. `winner_person_id` already had
      -- a simple FK; `loser_person_id` had NO foreign key at all and could name
      -- a person that does not exist. CASCADE matches the winner's existing
      -- semantics rather than inventing a new one.
      ('unified_person_merges',    'winner_person_id',  'company_id',
       'unified_person_merges_winner_person_id_fkey',     'unified_person_merges_winner_tenant_fk',
       'CASCADE'),
      ('unified_person_merges',    'loser_person_id',   'company_id',
       NULL,                                              'unified_person_merges_loser_tenant_fk',
       'CASCADE')
    ) AS e(tbl, person_col, tenant_col, old_fk, new_fk, del_action)
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = v_edge.tbl AND con.conname = v_edge.new_fk
    ) THEN
      RAISE NOTICE 'W5: % already present, skipping', v_edge.new_fk;
      CONTINUE;
    END IF;

    IF v_edge.old_fk IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', v_edge.tbl, v_edge.old_fk);
    END IF;

    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I, %I)
         REFERENCES public.unified_persons (id, company_id) ON DELETE %s',
      v_edge.tbl, v_edge.new_fk, v_edge.person_col, v_edge.tenant_col, v_edge.del_action);

    RAISE NOTICE 'W5: % -> tenant-safe composite on %(%, %)',
                 v_edge.new_fk, v_edge.tbl, v_edge.person_col, v_edge.tenant_col;
  END LOOP;
END
$convert$;

-- ---------------------------------------------------------------------------
-- Postcondition. All 11 composites must exist, or the whole migration rolls back.
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE
  v_count INT;
BEGIN
  SELECT count(*) INTO v_count
  FROM pg_constraint con
  JOIN pg_class s ON s.oid = con.conrelid
  JOIN pg_class t ON t.oid = con.confrelid
  JOIN pg_namespace n ON n.oid = s.relnamespace
  WHERE con.contype = 'f' AND n.nspname = 'public'
    AND t.relname = 'unified_persons'
    AND array_length(con.conkey, 1) = 2;

  -- 2 pre-existing (W2 lead_intelligence, W4 identity_claims) + 11 from W5 = 13.
  --
  -- This is a FLOOR, not an equality. It was originally written as `<> 13`,
  -- which asserted that the spine may never gain another tenant-safe reference
  -- — the opposite of the intent. LI-2 legitimately added two more
  -- (source_records, source_assertions) and the exact-count check then failed
  -- this migration's own idempotent replay in CI. A later phase adding a
  -- composite person FK is the desired behaviour and must not break W5.
  IF v_count < 13 THEN
    RAISE EXCEPTION 'W5 postcondition: expected at least 13 composite person FKs, found %', v_count;
  END IF;
  RAISE NOTICE 'W5: % tenant-safe composite person foreign keys verified (floor 13).', v_count;
END
$verify$;

COMMIT;

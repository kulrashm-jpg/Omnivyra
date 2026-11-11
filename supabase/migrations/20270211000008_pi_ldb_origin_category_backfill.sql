-- 20270211000008 pi_ldb_origin_category_backfill
-- (reserved by virality-83, 915c8717a on release/attest-20261127000000)
--
-- OWNER DECISION D3(b), 2026-11-11 (relayed by virality-e9; scope widened by
-- the coordinator): a ONE-TIME backfill of lead_intelligence.origin_category
-- for rows written before 20270211000005, so existing leads do not read as
-- "unknown origin". STRUCTURAL ONLY - never a free-text `source`, never an
-- adapter hint, never a display label:
--
--   BASIS 'classifyInboundLead'  rows with source_table = 'leads' whose `leads`
--     row EXISTS in the same tenant: the same precedence as
--     inboundLeadProvenance.classifyInboundLead (no `mode` column exists, so):
--     form_id -> inbound_form; integration_id -> inbound_webhook;
--     visitor_session_id -> website; otherwise manual.
--   BASIS 'pi_adapter_profile_contribution'  rows with source_table =
--     'canonical_leads' whose ORIGINATING prospect_source_contributions row
--     exists in the same tenant (at most one, uq_psc_one_originating_per_lead):
--     its source_category, which the writers take from explicit per-adapter
--     profile tables (PI_ADAPTER_PROFILES etc.), never from free text.
--   Anything else stays NULL (unknown). Unknown is honest; a guess is not.
--
-- RULES: writes ONLY where origin_category IS NULL, through 0005's trigger
-- (a classification is accepted once and never overwritten);
-- origin_observed_at = now(), the time Omnivyra ACCEPTED the classification
-- (D3 forbids the source event time).
--
-- BATCHED and COMMITTED PER BATCH: production size is unmeasured, so a
-- temporary PROCEDURE commits every p_batch rows (no long transaction, row
-- locks released per batch). Hence NO BEGIN/COMMIT around this file (a CALL
-- that commits cannot run inside a transaction block); one statement per call.
-- IDEMPOTENT: a re-run classifies 0 rows. POSTCONDITION: no classifiable row
-- remains NULL. The procedure is dropped at the end.
--
-- SNAPSHOT (for the rollback, since a data migration is not reversible by DDL):
-- every row this backfill writes is recorded in pi_ldb_origin_backfill_snapshot
-- (lead id, tenant, category, BASIS that classified it, when). No personal
-- data. Closed to every role (no grants; RLS on, no policy): only a migration
-- or an operator as owner reads it.
--
-- BEFORE ANY APPLY: a read-only DRY-RUN count (docs/pmo/prospect-intelligence/
-- PI-LDB-ORIGIN-BACKFILL-DRYRUN.sql) through Release-controls' catalogue
-- runner, owner-approved in the 83 tab, reviewed by virality-05.
-- Apply AFTER 20270211000007. APPLIED STATUS: never applied anywhere.

CREATE TABLE IF NOT EXISTS public.pi_ldb_origin_backfill_snapshot (
  lead_intelligence_id uuid PRIMARY KEY REFERENCES public.lead_intelligence (id) ON DELETE CASCADE,
  company_id           uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  category             text NOT NULL,
  basis                text NOT NULL,
  backfilled_at        timestamptz NOT NULL,
  CONSTRAINT pi_ldb_obs_basis_valid CHECK (basis IN ('classifyInboundLead', 'pi_adapter_profile_contribution'))
);

REVOKE ALL ON TABLE public.pi_ldb_origin_backfill_snapshot FROM PUBLIC, anon, authenticated, authenticator, service_role;
ALTER TABLE public.pi_ldb_origin_backfill_snapshot ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE PROCEDURE public.pi_ldb_origin_category_backfill(p_batch integer DEFAULT 2000)
LANGUAGE plpgsql
AS $proc$
DECLARE
  n integer;
BEGIN
  LOOP
    WITH classified AS (
      -- @classify-begin
      SELECT li.id, li.company_id,
             CASE
               WHEN li.source_table = 'leads' AND l.id IS NOT NULL THEN
                 CASE WHEN l.form_id IS NOT NULL THEN 'inbound_form'
                      WHEN l.integration_id IS NOT NULL THEN 'inbound_webhook'
                      WHEN l.visitor_session_id IS NOT NULL THEN 'website'
                      ELSE 'manual' END
               WHEN li.source_table = 'canonical_leads' AND psc.id IS NOT NULL THEN psc.source_category
             END AS category,
             CASE
               WHEN li.source_table = 'leads' AND l.id IS NOT NULL THEN 'classifyInboundLead'
               WHEN li.source_table = 'canonical_leads' AND psc.id IS NOT NULL THEN 'pi_adapter_profile_contribution'
             END AS basis
        FROM public.lead_intelligence li
        LEFT JOIN public.leads l
          ON li.source_table = 'leads' AND l.id::text = li.source_id AND l.company_id = li.company_id
        LEFT JOIN public.prospect_source_contributions psc
          ON li.source_table = 'canonical_leads' AND psc.canonical_lead_id::text = li.source_id
         AND psc.organization_id = li.company_id AND psc.contribution_role = 'originating'
       WHERE li.origin_category IS NULL
      -- @classify-end
    ), pick AS (
      SELECT id, company_id, category, basis FROM classified WHERE category IS NOT NULL LIMIT p_batch
    ), upd AS (
      UPDATE public.lead_intelligence li
         SET origin_category = pick.category, origin_observed_at = now()
        FROM pick
       WHERE li.id = pick.id AND li.origin_category IS NULL
      RETURNING li.id, li.company_id, li.origin_category
    ), snap AS (
      -- DO UPDATE, not DO NOTHING: the snapshot must hold what THIS run wrote
      -- (a stale row left by an earlier apply + rollback is replaced).
      INSERT INTO public.pi_ldb_origin_backfill_snapshot (lead_intelligence_id, company_id, category, basis, backfilled_at)
      SELECT upd.id, upd.company_id, upd.origin_category, pick.basis, now()
        FROM upd JOIN pick ON pick.id = upd.id
      ON CONFLICT (lead_intelligence_id) DO UPDATE
        SET company_id = EXCLUDED.company_id, category = EXCLUDED.category,
            basis = EXCLUDED.basis, backfilled_at = EXCLUDED.backfilled_at
    )
    -- The loop counts the UPDATE (rows classified), never the snapshot INSERT:
    -- an INSERT count of 0 must not end the loop while rows were still written.
    SELECT count(*) INTO n FROM upd;
    EXIT WHEN n = 0;
    COMMIT;
  END LOOP;
END
$proc$;

-- A new routine is EXECUTE-able by PUBLIC by default (proacl NULL = OPEN).
REVOKE ALL ON PROCEDURE public.pi_ldb_origin_category_backfill(integer) FROM PUBLIC, anon, authenticated, authenticator, service_role;

CALL public.pi_ldb_origin_category_backfill();

DO $verify$
DECLARE
  v_remaining bigint;
  r text;
BEGIN
  SELECT count(*) INTO v_remaining
    FROM public.lead_intelligence li
    LEFT JOIN public.leads l
      ON li.source_table = 'leads' AND l.id::text = li.source_id AND l.company_id = li.company_id
    LEFT JOIN public.prospect_source_contributions psc
      ON li.source_table = 'canonical_leads' AND psc.canonical_lead_id::text = li.source_id
     AND psc.organization_id = li.company_id AND psc.contribution_role = 'originating'
   WHERE li.origin_category IS NULL
     AND ((li.source_table = 'leads' AND l.id IS NOT NULL)
       OR (li.source_table = 'canonical_leads' AND psc.id IS NOT NULL));
  IF v_remaining <> 0 THEN
    RAISE EXCEPTION 'origin backfill postcondition: % structurally classifiable row(s) still have origin_category NULL', v_remaining;
  END IF;
  -- Every backfilled row is in the snapshot with the category it now carries.
  IF EXISTS (SELECT 1 FROM public.pi_ldb_origin_backfill_snapshot s
               JOIN public.lead_intelligence li ON li.id = s.lead_intelligence_id
              WHERE li.origin_category IS DISTINCT FROM s.category) THEN
    RAISE EXCEPTION 'origin backfill postcondition: a snapshot row disagrees with the category on its lead';
  END IF;
  -- The snapshot is closed to every client and application role.
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r)
       AND has_table_privilege(r, 'public.pi_ldb_origin_backfill_snapshot', 'SELECT') THEN
      RAISE EXCEPTION 'origin backfill postcondition: % can read pi_ldb_origin_backfill_snapshot', r;
    END IF;
  END LOOP;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.pi_ldb_origin_backfill_snapshot'::regclass) THEN
    RAISE EXCEPTION 'origin backfill postcondition: RLS is not enabled on pi_ldb_origin_backfill_snapshot';
  END IF;
END
$verify$;

DROP PROCEDURE IF EXISTS public.pi_ldb_origin_category_backfill(integer);

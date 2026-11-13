-- 20270217000043 - the 29 owner-rights public views become security_invoker (6f; version from 83; e9 ruling).
--
-- WHERE THIS CONCERN ALREADY LIVES (e9 standing question). 20261026000000_close_anon_rls_exposure named these 29
--   views and REVOKEd anon / authenticated from them - their only protection. They still run with their OWNER's
--   rights (postgres): one future GRANT to authenticated and every row of every base table behind them - credit
--   ledger, usage, reconciliation, finance roles, auth.users - is readable regardless of RLS. Nothing has flipped
--   them since (83 C65: reloptions NULL on all 29). This migration closes that by construction; it changes nothing
--   for today's readers.
--
-- WHAT. ALTER VIEW ... SET (security_invoker = true) on each of the 29 - NOT a re-create: the definition, owner and
--   ACL are kept. The REVOKE from anon / authenticated is restated (gate rule for owner-rights views; enumerative
--   hardening). Schema only, no data.
--
-- WHY NO READ BREAKS (measured in prod, 83 C64/C65, catalog only, owner-approved). Exactly two roles hold SELECT on
--   these views: postgres (the owner) and service_role. Both have rolbypassrls = true, and service_role holds SELECT
--   on every base relation behind every view, auth.users included - 0 rows with (base SELECT false AND no bypass).
--   The 7 views with app readers (company_blog_performance_summary, v_reservation_health, v_billing_operations_health,
--   v_company_financial_timeline, weekly_alignment_summary, weekly_refinement_status; read via the service-role
--   client) keep reading exactly as before. Each company-facing read filters by the authorized company (6f scope
--   check for e9, with a positive control).
--
-- ROLLBACK: rollbacks/owner_rights_views_security_invoker_rollback.sql - ALTER VIEW ... RESET (security_invoker) on
--   the same 29 (back to owner rights); the restated REVOKE is the pre-existing posture and is not reverted.

DO $migrate$
DECLARE
  v text;
  missing text[] := '{}';
  views text[] := ARRAY[
    'ai_suggestion_acceptance_rate', 'canonical_campaign_entities', 'canonical_company_entities',
    'community_ai_execution_success_rate', 'company_blog_performance_summary', 'company_financial_reconciliation',
    'cost_margin_daily_view', 'cost_monitoring_daily_view', 'deep_view', 'free_credits_activity', 'growth_view',
    'identity_health_metrics', 'market_pulse_latest_run_view', 'org_economics_view', 'pricing_health_view',
    'retention_candidates', 'snapshot_view', 'unified_transactions_with_anomalies_view', 'v_approval_health',
    'v_billing_operations_health', 'v_company_financial_timeline', 'v_finance_role_holders', 'v_pricing_catalog',
    'v_reservation_health', 'vw_company_report_stats', 'vw_feature_completion_summary', 'vw_free_reports_by_domain',
    'weekly_alignment_summary', 'weekly_refinement_status'
  ];
BEGIN
  -- Preflight: every one of the 29 exists AS A VIEW (a materialized view or table under the name means this is not
  -- the object 20261026000000 hardened - refuse rather than act on something else).
  FOREACH v IN ARRAY views LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE n.nspname = 'public' AND c.relname = v AND c.relkind = 'v') THEN
      missing := missing || v;
    END IF;
  END LOOP;
  IF array_length(missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION '043 preflight: not a public view (absent, or another relkind): %', array_to_string(missing, ', ');
  END IF;

  -- Snapshot BEFORE the flip: which of the 29 service_role (the app's reader) can SELECT. The postcondition asserts
  -- the SAME set afterwards (83: ALTER VIEW SET keeps the ACL - measured, not assumed). Hosted: all 29; the governed
  -- replay grants service_role nothing by default, so its set is whatever the environment really has.
  CREATE TEMP TABLE IF NOT EXISTS _m043_service_role_before (view_name text PRIMARY KEY);
  TRUNCATE _m043_service_role_before;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    INSERT INTO _m043_service_role_before
      SELECT x FROM unnest(views) x WHERE has_table_privilege('service_role', format('public.%I', x), 'SELECT');
  END IF;

  FOREACH v IN ARRAY views LOOP
    EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', v);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', v);
  END LOOP;
END
$migrate$;

-- Postcondition: exactly what this migration promises, measured on all 29.
DO $verify$
DECLARE
  v text;
  r text;
  p text;
  views text[] := ARRAY[
    'ai_suggestion_acceptance_rate', 'canonical_campaign_entities', 'canonical_company_entities',
    'community_ai_execution_success_rate', 'company_blog_performance_summary', 'company_financial_reconciliation',
    'cost_margin_daily_view', 'cost_monitoring_daily_view', 'deep_view', 'free_credits_activity', 'growth_view',
    'identity_health_metrics', 'market_pulse_latest_run_view', 'org_economics_view', 'pricing_health_view',
    'retention_candidates', 'snapshot_view', 'unified_transactions_with_anomalies_view', 'v_approval_health',
    'v_billing_operations_health', 'v_company_financial_timeline', 'v_finance_role_holders', 'v_pricing_catalog',
    'v_reservation_health', 'vw_company_report_stats', 'vw_feature_completion_summary', 'vw_free_reports_by_domain',
    'weekly_alignment_summary', 'weekly_refinement_status'
  ];
BEGIN
  IF array_length(views, 1) <> 29 THEN RAISE EXCEPTION '043 postcondition: the view list must hold 29 names'; END IF;
  FOREACH v IN ARRAY views LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE n.nspname = 'public' AND c.relname = v AND c.relkind = 'v'
                      AND 'security_invoker=true' = ANY (coalesce(c.reloptions, '{}'))) THEN
      RAISE EXCEPTION '043 postcondition: public.% is not security_invoker', v;
    END IF;
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      FOREACH p IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
        IF has_table_privilege(r, format('public.%I', v), p) THEN
          RAISE EXCEPTION '043 postcondition: % holds % on public.%', r, p, v;
        END IF;
      END LOOP;
      FOREACH p IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'] LOOP
        IF has_any_column_privilege(r, format('public.%I', v), p) THEN
          RAISE EXCEPTION '043 postcondition: % holds a column-level % on public.%', r, p, v;
        END IF;
      END LOOP;
    END LOOP;
    -- 83: service_role keeps SELECT on every view it could read before the flip (snapshot above).
    IF EXISTS (SELECT 1 FROM _m043_service_role_before b WHERE b.view_name = v)
       AND NOT has_table_privilege('service_role', format('public.%I', v), 'SELECT') THEN
      RAISE EXCEPTION '043 postcondition: service_role lost SELECT on public.%', v;
    END IF;
  END LOOP;
  DROP TABLE IF EXISTS _m043_service_role_before;
END
$verify$;

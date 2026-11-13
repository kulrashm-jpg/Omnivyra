-- Rollback of 20270217000043_owner_rights_views_security_invoker.sql (6f).
-- RESETs security_invoker on the same 29 views, returning them to owner rights (their state before 043). The
-- restated REVOKE from anon / authenticated is the pre-existing posture (20261026000000) and is NOT reverted.
-- No data is touched.
DO $rollback$
DECLARE
  v text;
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
  FOREACH v IN ARRAY views LOOP
    IF to_regclass(format('public.%I', v)) IS NOT NULL THEN
      EXECUTE format('ALTER VIEW public.%I RESET (security_invoker)', v);
    END IF;
  END LOOP;
  FOREACH v IN ARRAY views LOOP
    IF EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass(format('public.%I', v))
                 AND 'security_invoker=true' = ANY (coalesce(reloptions, '{}'))) THEN
      RAISE EXCEPTION '043 rollback: public.% is still security_invoker', v;
    END IF;
  END LOOP;
END
$rollback$;

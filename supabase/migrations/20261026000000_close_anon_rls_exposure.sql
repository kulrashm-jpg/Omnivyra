-- ============================================================================
-- SECURITY — close the anonymous / public-key exposure of the public schema
-- STEP 3AH-70 · prepared 2026-09-14 · NOT YET APPLIED TO PRODUCTION
-- ============================================================================
--
-- WHAT WAS EXPOSED (measured read-only against production, 2026-09-14)
--   Supabase's default privileges grant ALL on every new public table, and
--   EXECUTE on every new public function, to `anon` and `authenticated`.
--   PostgREST serves the public schema to anyone holding the publishable key,
--   which ships in the browser bundle. RLS is the only thing that constrains
--   those roles, so:
--
--   1. 177 tables had RLS DISABLED: anon and authenticated held SELECT, INSERT,
--      UPDATE, DELETE and TRUNCATE on all of them (651,866 rows; 139 carry
--      tenant/person columns; 4 carry credential columns).
--   2. 29 SECURITY DEFINER functions were EXECUTE-able by anon/authenticated
--      (and PUBLIC). They run as the owner, which bypasses RLS. 28 have no caller
--      check at all, e.g. apply_credit_transaction_v2, security_get_secret,
--      soft_delete_company, activate_invitation_membership.
--   3. 29 of 37 views are owner-rights (not security_invoker) views and were
--      SELECT-able by anon/authenticated. Owner rights bypass RLS on every table
--      they read.
--   4. 11 policies on RLS-enabled tables grant role {public} (which includes
--      anon) unconditional access (USING true / WITH CHECK true).
--
-- WHY THIS CANNOT BREAK THE APPLICATION (audited on main 9d706239)
--   * The browser performs NO direct table, view or RPC access. The only
--     browser database path is the realtime subscription on credit_transactions,
--     which already has RLS and a policy and is NOT touched here.
--   * Every server path (API routes, cron, Railway worker, Edge Functions,
--     operator scripts) uses the service-role key. service_role has BYPASSRLS
--     and keeps its explicit grants. Owner (postgres) access, e.g. pg_cron,
--     is unaffected.
--   * No existing policy on these tables is activated by enabling RLS (there
--     were 0 dormant policies). No policy or view references any of the 29
--     functions.
--
-- WHAT THIS DOES
--   1. 177 tables: ENABLE ROW LEVEL SECURITY (no policy: deny-by-default for
--      anon/authenticated) and REVOKE ALL FROM anon, authenticated.
--   2. 29 SECURITY DEFINER functions: REVOKE EXECUTE FROM PUBLIC, anon,
--      authenticated; GRANT EXECUTE TO service_role (explicit, so server paths
--      never depended on PUBLIC).
--   3. 29 owner-rights views: REVOKE ALL FROM anon, authenticated.
--      8 security_invoker views: REVOKE ALL FROM anon; revoke write privileges
--      from authenticated (reads stay subject to the underlying RLS).
--   4. 11 unconditional {public} policies: retargeted TO service_role. Nothing
--      is dropped; server behaviour is unchanged because service_role bypasses
--      RLS. Grants on those 8 tables are revoked from anon, authenticated.
--   5. Intentionally public, read-only: content_type (format vocabulary) and
--      blog_series / blog_series_posts / blog_relationships (published-blog
--      metadata; no tenant column, no PII). Their SELECT policies are KEPT. Only
--      write privileges are revoked, so the public can read but never write.
--   5b. TRUNCATE (which RLS does NOT govern) is revoked from anon and
--      authenticated on every public table. No anon/authenticated path uses it.
--   6. Future objects: default privileges for objects created by postgres no
--      longer grant anything to anon, no longer grant TRUNCATE to authenticated,
--      and new functions are no longer EXECUTE-able by PUBLIC. service_role
--      defaults are unchanged. A new browser-facing object must now be granted
--      explicitly, next to its policy.
--   7. Self-verification: the transaction aborts if any protected object is still
--      reachable by anon/authenticated after the statements above.
--
-- REPLAY SAFETY
--   Objects absent from the target database are skipped, so a clean replay
--   without them succeeds. Every statement is idempotent (ENABLE RLS, REVOKE,
--   GRANT and ALTER POLICY ... TO are all re-runnable).
--
-- APPLY  (after explicit authorization only)
--   psql -1 -v ON_ERROR_STOP=1 with SET lock_timeout = '15s'. ENABLE ROW LEVEL
--   SECURITY takes a brief ACCESS EXCLUSIVE lock per table. On a lock timeout the
--   whole transaction rolls back and can simply be re-run.
-- ROLLBACK
--   supabase/migrations/rollbacks/close_anon_rls_exposure_rollback.sql restores
--   the previous privileges exactly. It re-opens the exposure; use it only to
--   restore service.
-- ============================================================================

DO $$
DECLARE
  t text;
  applied integer := 0;
  skipped integer := 0;
  protected_tables text[] := ARRAY[
    'active_lead_runs',
    'active_leads',
    'adapter_configs',
    'ai_message_drafts',
    'alert_rules',
    'analyst_collection_items',
    'analytics_competitor_domains',
    'analytics_intelligence_snapshots',
    'analytics_materializations',
    'analytics_serp_acquisition_runs',
    'analytics_serp_provider_health',
    'analytics_serp_query_queue',
    'analytics_serp_results',
    'analytics_serp_snapshots',
    'analytics_warehouse_facts',
    'angle_industry_matrix',
    'audit_export_jobs',
    'auth_audit_logs',
    'author_identity_links',
    'billing_policy_config',
    'block_templates',
    'campaign_autonomous_learnings',
    'canonical_backlink_signals',
    'community_recommendations',
    'company_execution_config',
    'company_llm_configs',
    'company_scheduler_prefs',
    'company_settings',
    'company_setup_progress',
    'consent_records',
    'content_asset_attachment',
    'content_asset_platform_override',
    'content_core_asset',
    'content_external_video_asset',
    'copilot_responses',
    'cost_budgets',
    'cost_events',
    'cost_reconciliation_adjustments',
    'cost_reconciliation_runs',
    'creator_alert_state',
    'creator_audit_log',
    'creator_cron_lease',
    'creator_dead_letter_jobs',
    'creator_execution_audit_logs',
    'creator_execution_dead_letter_queue',
    'creator_execution_metrics',
    'creator_execution_summaries',
    'creator_operational_events',
    'creator_render_attempt',
    'creator_render_governance_state',
    'creator_render_job',
    'creator_render_job_events',
    'creator_render_job_state',
    'creator_render_jobs',
    'creator_render_metrics',
    'creator_render_moderation_event',
    'creator_render_ops_audit',
    'creator_render_output',
    'creator_render_provider',
    'creator_render_queue_job',
    'creator_render_validation_manifests',
    'creator_render_variant',
    'creator_template_registry',
    'creator_upload_rate_state',
    'customer_operations_scores',
    'customer_population_classification',
    'decision_priority_queue',
    'deployment_telemetry_snapshots',
    'earn_credit_actions',
    'engagement_identity_candidates',
    'escalations',
    'execution_observability_records',
    'execution_partitions',
    'external_api_assignments',
    'external_api_connections',
    'external_api_usage_logs',
    'feature_flags',
    'feedback_submissions',
    'free_credit_grants',
    'governance_audit_runs',
    'governance_convergence_scores',
    'governance_enforcement_events',
    'incident_events',
    'incident_timeline_entries',
    'incidents',
    'ingestion_throughput_state',
    'integration_activity_events',
    'integration_capabilities',
    'intelligence_company_overrides',
    'intelligence_execution_log',
    'intelligence_global_config',
    'intelligence_governance_policies',
    'intelligence_incidents',
    'intelligence_role_assignments',
    'intelligence_roles',
    'intelligence_throttle_config',
    'intent_savings_log',
    'investigation_workspace_items',
    'investigation_workspaces',
    'ip_org_creations',
    'job_idempotency_keys',
    'listening_configurations',
    'listening_executions',
    'listening_signal_dedup',
    'listening_sources',
    'llm_models',
    'llm_providers',
    'market_pulse_automation_settings',
    'market_pulse_finding_actions',
    'market_pulse_findings',
    'market_pulse_memory',
    'market_pulse_runs',
    'migration_dry_runs',
    'moderation_decisions',
    'monetization_beta_drills',
    'monetization_beta_orgs',
    'monetization_beta_support_actions',
    'monetization_beta_support_cases',
    'monetization_beta_users',
    'monitoring_runs',
    'observability_convergence_projections',
    'operational_safety_rail_events',
    'operational_safety_rails',
    'operator_actions',
    'opportunity_assignments',
    'opportunity_dispositions',
    'opportunity_feed_items',
    'opportunity_graph_edges',
    'opportunity_graph_nodes',
    'opportunity_lifecycle_states',
    'opportunity_notes',
    'opportunity_tags',
    'org_learning_metrics',
    'pending_invite_unlocks',
    'platform_cost_allocations',
    'platform_cost_categories',
    'platform_stabilization_events',
    'platform_stabilization_windows',
    'post_analytics_polls',
    'post_events',
    'production_certification_reports',
    'production_rollout_plans',
    'production_rollout_stage_executions',
    'projection_sync_state',
    'provider_invoice_imports',
    'referrals',
    'region_routing',
    'replay_operations',
    'replay_partitions',
    'report_automation_configs',
    'report_automation_events',
    'report_definitions',
    'report_executions',
    'report_notification_events',
    'resilience_advisory_plans',
    'resilience_validation_runs',
    'retention_executions',
    'retention_policies',
    'saved_intelligence_views',
    'semantic_index_entries',
    'semantic_indexing_jobs',
    'semantic_indexing_partitions',
    'semantic_retrieval_explanations',
    'signal_intent_clusters',
    'sla_breaches',
    'source_health_states',
    'sre_health_snapshots',
    'support_snapshots',
    'system_anomalies',
    'system_health_metrics',
    'tenant_onboarding_runtime_stages',
    'token_refresh_locks',
    'unified_person_merges',
    'whatsapp_broadcast_recipients',
    'whatsapp_broadcasts',
    'whatsapp_media_cache',
    'whatsapp_templates'
  ];
BEGIN
  FOREACH t IN ARRAY protected_tables LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      skipped := skipped + 1;
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', t);
    applied := applied + 1;
  END LOOP;
  RAISE NOTICE 'close_anon_rls_exposure: tables protected=%, absent=%', applied, skipped;
END $$;

-- 2. SECURITY DEFINER functions: server-only.
DO $$
DECLARE
  f text;
  applied integer := 0;
  definer_functions text[] := ARRAY[
    'public.activate_invitation_membership(uuid,uuid,timestamp with time zone)',
    'public.admin_override_community_ai_status(uuid,text,text,uuid)',
    'public.apply_credit_transaction_v2(uuid,text,integer,numeric,text,text,text,uuid,text,text,uuid,text,jsonb)',
    'public.auth_user_confirmed(text)',
    'public.auth_user_has_password(uuid)',
    'public.claim_email_jobs(text,integer)',
    'public.configure_domain_reminder_cron(text,text)',
    'public.delete_intelligence_signals_older_than_365_days()',
    'public.disable_company_cascade(uuid,uuid,text)',
    'public.finalize_email_job(uuid,text,text,text,timestamp with time zone)',
    'public.flush_community_ai_metric_dlq(integer)',
    'public.get_usage_report(uuid,uuid,text,text,text,text,timestamp with time zone,timestamp with time zone,boolean)',
    'public.image_metadata_append_query(text[],text)',
    'public.increment_automation_usage_if_allowed(uuid,integer)',
    'public.increment_bolt_run_progress(uuid,integer,integer,integer,integer)',
    'public.increment_usage_meter(uuid,integer,integer,bigint,bigint,bigint,bigint,bigint,numeric)',
    'public.invalidate_user_sessions(uuid,text)',
    'public.meta_oauth_apply(jsonb,jsonb,jsonb,jsonb)',
    'public.omnivyra_upsert_behavioral_analytics(jsonb,jsonb)',
    'public.prune_rpa_artifacts(integer)',
    'public.reap_community_ai_action_leases()',
    'public.record_email_event(uuid,text,jsonb,text)',
    'public.refresh_community_ai_execution_metrics_daily(integer)',
    'public.security_create_secret(text,text,text)',
    'public.security_delete_secret(uuid)',
    'public.security_get_secret(uuid)',
    'public.soft_delete_company(uuid,uuid,text)',
    'public.trigger_domain_reminder_cron()',
    'public.trigger_recover_stale_reports_cron()'
  ];
BEGIN
  FOREACH f IN ARRAY definer_functions LOOP
    IF to_regprocedure(f) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
    applied := applied + 1;
  END LOOP;
  RAISE NOTICE 'close_anon_rls_exposure: definer functions restricted=%', applied;
END $$;

-- 3. Views.
DO $$
DECLARE
  v text;
  owner_rights_views text[] := ARRAY[
    'ai_suggestion_acceptance_rate',
    'canonical_campaign_entities',
    'canonical_company_entities',
    'community_ai_execution_success_rate',
    'company_blog_performance_summary',
    'company_financial_reconciliation',
    'cost_margin_daily_view',
    'cost_monitoring_daily_view',
    'deep_view',
    'free_credits_activity',
    'growth_view',
    'identity_health_metrics',
    'market_pulse_latest_run_view',
    'org_economics_view',
    'pricing_health_view',
    'retention_candidates',
    'snapshot_view',
    'unified_transactions_with_anomalies_view',
    'v_approval_health',
    'v_billing_operations_health',
    'v_company_financial_timeline',
    'v_finance_role_holders',
    'v_pricing_catalog',
    'v_reservation_health',
    'vw_company_report_stats',
    'vw_feature_completion_summary',
    'vw_free_reports_by_domain',
    'weekly_alignment_summary',
    'weekly_refinement_status'
  ];
  invoker_views text[] := ARRAY[
    'blog_performance_summary',
    'campaign_insights_view',
    'community_ai_network_intelligence',
    'content_opportunities_view',
    'engagement_insights_view',
    'lead_intelligence_view',
    'market_pulse_view',
    'omnivyra_decision_feature_base_view'
  ];
BEGIN
  FOREACH v IN ARRAY owner_rights_views LOOP
    IF to_regclass(format('public.%I', v)) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', v);
  END LOOP;
  FOREACH v IN ARRAY invoker_views LOOP
    IF to_regclass(format('public.%I', v)) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', v);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.%I FROM authenticated', v);
  END LOOP;
END $$;

-- 4. Unconditional {public} policies with no anonymous consumer → service_role.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('blog_analytics', 'owner_select'),
      ('blog_analytics', 'tracker_insert'),
      ('blog_analytics_daily', 'service_all_daily'),
      ('blog_intelligence_settings', 'service_all'),
      ('blog_post_likes', 'Public read blog likes'),
      ('campaign_design_systems', 'cds_company_rw'),
      ('company_blog_read_sessions', 'anyone can insert company blog session'),
      ('company_blog_read_sessions', 'anyone can update company blog session'),
      ('creator_template_collections', 'ctc_company_rw'),
      ('creator_user_template_versions', 'cutv_company_rw'),
      ('creator_user_templates', 'cut_company_rw')
    ) AS x(tbl, pol)
  LOOP
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = r.tbl AND policyname = r.pol) THEN
      EXECUTE format('ALTER POLICY %I ON public.%I TO service_role', r.pol, r.tbl);
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  t text;
  retargeted_tables text[] := ARRAY[
    'blog_analytics',
    'blog_analytics_daily',
    'blog_intelligence_settings',
    'blog_post_likes',
    'campaign_design_systems',
    'company_blog_read_sessions',
    'creator_template_collections',
    'creator_user_template_versions',
    'creator_user_templates'
  ];
  public_read_tables text[] := ARRAY[
    'blog_relationships',
    'blog_series',
    'blog_series_posts',
    'content_type'
  ];
BEGIN
  FOREACH t IN ARRAY retargeted_tables LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', t);
  END LOOP;
  -- 5. Intentionally public, read-only: SELECT policy kept, writes revoked.
  FOREACH t IN ARRAY public_read_tables LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;

-- 5b. TRUNCATE is NOT governed by RLS: a role holding it can empty a table whatever its
--     policies say. anon and authenticated held it on every public table (835 in production).
--     No legitimate path uses it: PostgREST cannot issue TRUNCATE, no function executes
--     caller-supplied SQL, and the server truncates (if ever) as service_role/owner.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT c.relname FROM pg_class c
            WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p') ORDER BY c.relname
  LOOP
    EXECUTE format('REVOKE TRUNCATE ON TABLE public.%I FROM anon, authenticated', r.relname);
  END LOOP;
END $$;

-- 6. Future objects created by postgres.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE TRUNCATE ON TABLES FROM authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- 7. Self-verification — abort the whole transaction if anything is still reachable.
DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO bad
    FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
     AND c.relname = ANY (ARRAY[
       'active_lead_runs',
       'active_leads',
       'adapter_configs',
       'ai_message_drafts',
       'alert_rules',
       'analyst_collection_items',
       'analytics_competitor_domains',
       'analytics_intelligence_snapshots',
       'analytics_materializations',
       'analytics_serp_acquisition_runs',
       'analytics_serp_provider_health',
       'analytics_serp_query_queue',
       'analytics_serp_results',
       'analytics_serp_snapshots',
       'analytics_warehouse_facts',
       'angle_industry_matrix',
       'audit_export_jobs',
       'auth_audit_logs',
       'author_identity_links',
       'billing_policy_config',
       'block_templates',
       'campaign_autonomous_learnings',
       'canonical_backlink_signals',
       'community_recommendations',
       'company_execution_config',
       'company_llm_configs',
       'company_scheduler_prefs',
       'company_settings',
       'company_setup_progress',
       'consent_records',
       'content_asset_attachment',
       'content_asset_platform_override',
       'content_core_asset',
       'content_external_video_asset',
       'copilot_responses',
       'cost_budgets',
       'cost_events',
       'cost_reconciliation_adjustments',
       'cost_reconciliation_runs',
       'creator_alert_state',
       'creator_audit_log',
       'creator_cron_lease',
       'creator_dead_letter_jobs',
       'creator_execution_audit_logs',
       'creator_execution_dead_letter_queue',
       'creator_execution_metrics',
       'creator_execution_summaries',
       'creator_operational_events',
       'creator_render_attempt',
       'creator_render_governance_state',
       'creator_render_job',
       'creator_render_job_events',
       'creator_render_job_state',
       'creator_render_jobs',
       'creator_render_metrics',
       'creator_render_moderation_event',
       'creator_render_ops_audit',
       'creator_render_output',
       'creator_render_provider',
       'creator_render_queue_job',
       'creator_render_validation_manifests',
       'creator_render_variant',
       'creator_template_registry',
       'creator_upload_rate_state',
       'customer_operations_scores',
       'customer_population_classification',
       'decision_priority_queue',
       'deployment_telemetry_snapshots',
       'earn_credit_actions',
       'engagement_identity_candidates',
       'escalations',
       'execution_observability_records',
       'execution_partitions',
       'external_api_assignments',
       'external_api_connections',
       'external_api_usage_logs',
       'feature_flags',
       'feedback_submissions',
       'free_credit_grants',
       'governance_audit_runs',
       'governance_convergence_scores',
       'governance_enforcement_events',
       'incident_events',
       'incident_timeline_entries',
       'incidents',
       'ingestion_throughput_state',
       'integration_activity_events',
       'integration_capabilities',
       'intelligence_company_overrides',
       'intelligence_execution_log',
       'intelligence_global_config',
       'intelligence_governance_policies',
       'intelligence_incidents',
       'intelligence_role_assignments',
       'intelligence_roles',
       'intelligence_throttle_config',
       'intent_savings_log',
       'investigation_workspace_items',
       'investigation_workspaces',
       'ip_org_creations',
       'job_idempotency_keys',
       'listening_configurations',
       'listening_executions',
       'listening_signal_dedup',
       'listening_sources',
       'llm_models',
       'llm_providers',
       'market_pulse_automation_settings',
       'market_pulse_finding_actions',
       'market_pulse_findings',
       'market_pulse_memory',
       'market_pulse_runs',
       'migration_dry_runs',
       'moderation_decisions',
       'monetization_beta_drills',
       'monetization_beta_orgs',
       'monetization_beta_support_actions',
       'monetization_beta_support_cases',
       'monetization_beta_users',
       'monitoring_runs',
       'observability_convergence_projections',
       'operational_safety_rail_events',
       'operational_safety_rails',
       'operator_actions',
       'opportunity_assignments',
       'opportunity_dispositions',
       'opportunity_feed_items',
       'opportunity_graph_edges',
       'opportunity_graph_nodes',
       'opportunity_lifecycle_states',
       'opportunity_notes',
       'opportunity_tags',
       'org_learning_metrics',
       'pending_invite_unlocks',
       'platform_cost_allocations',
       'platform_cost_categories',
       'platform_stabilization_events',
       'platform_stabilization_windows',
       'post_analytics_polls',
       'post_events',
       'production_certification_reports',
       'production_rollout_plans',
       'production_rollout_stage_executions',
       'projection_sync_state',
       'provider_invoice_imports',
       'referrals',
       'region_routing',
       'replay_operations',
       'replay_partitions',
       'report_automation_configs',
       'report_automation_events',
       'report_definitions',
       'report_executions',
       'report_notification_events',
       'resilience_advisory_plans',
       'resilience_validation_runs',
       'retention_executions',
       'retention_policies',
       'saved_intelligence_views',
       'semantic_index_entries',
       'semantic_indexing_jobs',
       'semantic_indexing_partitions',
       'semantic_retrieval_explanations',
       'signal_intent_clusters',
       'sla_breaches',
       'source_health_states',
       'sre_health_snapshots',
       'support_snapshots',
       'system_anomalies',
       'system_health_metrics',
       'tenant_onboarding_runtime_stages',
       'token_refresh_locks',
       'unified_person_merges',
       'whatsapp_broadcast_recipients',
       'whatsapp_broadcasts',
       'whatsapp_media_cache',
       'whatsapp_templates'
     ])
     AND (NOT c.relrowsecurity
          OR has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
          OR has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'));
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'close_anon_rls_exposure: tables still exposed: %', bad;
  END IF;

  -- Scoped to the objects this migration owns, so a future baseline regenerated
  -- without ACLs can never make this (already-applied) migration fail on replay.
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO bad
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND ('public.' || p.oid::regprocedure::text) = ANY (ARRAY[
       'public.activate_invitation_membership(uuid,uuid,timestamp with time zone)',
       'public.admin_override_community_ai_status(uuid,text,text,uuid)',
       'public.apply_credit_transaction_v2(uuid,text,integer,numeric,text,text,text,uuid,text,text,uuid,text,jsonb)',
       'public.auth_user_confirmed(text)',
       'public.auth_user_has_password(uuid)',
       'public.claim_email_jobs(text,integer)',
       'public.configure_domain_reminder_cron(text,text)',
       'public.delete_intelligence_signals_older_than_365_days()',
       'public.disable_company_cascade(uuid,uuid,text)',
       'public.finalize_email_job(uuid,text,text,text,timestamp with time zone)',
       'public.flush_community_ai_metric_dlq(integer)',
       'public.get_usage_report(uuid,uuid,text,text,text,text,timestamp with time zone,timestamp with time zone,boolean)',
       'public.image_metadata_append_query(text[],text)',
       'public.increment_automation_usage_if_allowed(uuid,integer)',
       'public.increment_bolt_run_progress(uuid,integer,integer,integer,integer)',
       'public.increment_usage_meter(uuid,integer,integer,bigint,bigint,bigint,bigint,bigint,numeric)',
       'public.invalidate_user_sessions(uuid,text)',
       'public.meta_oauth_apply(jsonb,jsonb,jsonb,jsonb)',
       'public.omnivyra_upsert_behavioral_analytics(jsonb,jsonb)',
       'public.prune_rpa_artifacts(integer)',
       'public.reap_community_ai_action_leases()',
       'public.record_email_event(uuid,text,jsonb,text)',
       'public.refresh_community_ai_execution_metrics_daily(integer)',
       'public.security_create_secret(text,text,text)',
       'public.security_delete_secret(uuid)',
       'public.security_get_secret(uuid)',
       'public.soft_delete_company(uuid,uuid,text)',
       'public.trigger_domain_reminder_cron()',
       'public.trigger_recover_stale_reports_cron()'
     ])
     AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'close_anon_rls_exposure: SECURITY DEFINER functions still executable by anon/authenticated: %', bad;
  END IF;

  SELECT string_agg(c.relname, ', ') INTO bad
    FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('v', 'm')
     AND c.relname = ANY (ARRAY[
       'ai_suggestion_acceptance_rate',
       'blog_performance_summary',
       'campaign_insights_view',
       'canonical_campaign_entities',
       'canonical_company_entities',
       'community_ai_execution_success_rate',
       'community_ai_network_intelligence',
       'company_blog_performance_summary',
       'company_financial_reconciliation',
       'content_opportunities_view',
       'cost_margin_daily_view',
       'cost_monitoring_daily_view',
       'deep_view',
       'engagement_insights_view',
       'free_credits_activity',
       'growth_view',
       'identity_health_metrics',
       'lead_intelligence_view',
       'market_pulse_latest_run_view',
       'market_pulse_view',
       'omnivyra_decision_feature_base_view',
       'org_economics_view',
       'pricing_health_view',
       'retention_candidates',
       'snapshot_view',
       'unified_transactions_with_anomalies_view',
       'v_approval_health',
       'v_billing_operations_health',
       'v_company_financial_timeline',
       'v_finance_role_holders',
       'v_pricing_catalog',
       'v_reservation_health',
       'vw_company_report_stats',
       'vw_feature_completion_summary',
       'vw_free_reports_by_domain',
       'weekly_alignment_summary',
       'weekly_refinement_status'
     ])
     AND (has_table_privilege('anon', c.oid, 'SELECT')
          OR (c.relname = ANY (ARRAY['ai_suggestion_acceptance_rate', 'canonical_campaign_entities', 'canonical_company_entities', 'community_ai_execution_success_rate', 'company_blog_performance_summary', 'company_financial_reconciliation', 'cost_margin_daily_view', 'cost_monitoring_daily_view', 'deep_view', 'free_credits_activity', 'growth_view', 'identity_health_metrics', 'market_pulse_latest_run_view', 'org_economics_view', 'pricing_health_view', 'retention_candidates', 'snapshot_view', 'unified_transactions_with_anomalies_view', 'v_approval_health', 'v_billing_operations_health', 'v_company_financial_timeline', 'v_finance_role_holders', 'v_pricing_catalog', 'v_reservation_health', 'vw_company_report_stats', 'vw_feature_completion_summary', 'vw_free_reports_by_domain', 'weekly_alignment_summary', 'weekly_refinement_status'])
              AND has_table_privilege('authenticated', c.oid, 'SELECT')));
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'close_anon_rls_exposure: views still readable: %', bad;
  END IF;

  SELECT string_agg(tablename || '.' || policyname, ', ') INTO bad
    FROM pg_policies
   WHERE schemaname = 'public'
     AND (tablename, policyname) IN (('blog_analytics', 'owner_select'), ('blog_analytics', 'tracker_insert'), ('blog_analytics_daily', 'service_all_daily'), ('blog_intelligence_settings', 'service_all'), ('blog_post_likes', 'Public read blog likes'), ('campaign_design_systems', 'cds_company_rw'), ('company_blog_read_sessions', 'anyone can insert company blog session'), ('company_blog_read_sessions', 'anyone can update company blog session'), ('creator_template_collections', 'ctc_company_rw'), ('creator_user_template_versions', 'cutv_company_rw'), ('creator_user_templates', 'cut_company_rw'))
     AND roles::text <> '{service_role}';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'close_anon_rls_exposure: policies not retargeted to service_role: %', bad;
  END IF;

  SELECT string_agg(c.relname, ', ') INTO bad
    FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
     AND (has_table_privilege('anon', c.oid, 'TRUNCATE') OR has_table_privilege('authenticated', c.oid, 'TRUNCATE'));
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'close_anon_rls_exposure: TRUNCATE (not governed by RLS) still held by anon/authenticated on: %', bad;
  END IF;
END $$;

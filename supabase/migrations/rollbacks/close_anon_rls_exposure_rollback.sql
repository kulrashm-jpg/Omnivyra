-- ROLLBACK for 20261026000000_close_anon_rls_exposure.sql
-- WARNING: this RE-OPENS the anonymous exposure the migration closed. Use only to
-- restore service after a verified regression, then re-apply the fix.
-- Restores the pre-migration state exactly as measured on production 2026-09-14:
-- RLS off and ALL granted to anon/authenticated on the 177 tables; EXECUTE for
-- PUBLIC/anon/authenticated on the 29 definer functions; view grants; policy roles;
-- default privileges.

DO $$
DECLARE t text; protected_tables text[] := ARRAY[
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
    IF to_regclass(format('public.%I', t)) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('GRANT ALL ON TABLE public.%I TO anon, authenticated', t);
    EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

DO $$
DECLARE f text; definer_functions text[] := ARRAY[
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
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC, anon, authenticated', f);
  END LOOP;
END $$;

DO $$
DECLARE v text; all_views text[] := ARRAY[
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
  ];
BEGIN
  FOREACH v IN ARRAY all_views LOOP
    IF to_regclass(format('public.%I', v)) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('GRANT ALL ON TABLE public.%I TO anon, authenticated', v);
  END LOOP;
END $$;

DO $$
DECLARE r record; t text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
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
  ) AS x(tbl, pol) LOOP
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = r.tbl AND policyname = r.pol) THEN
      EXECUTE format('ALTER POLICY %I ON public.%I TO public', r.pol, r.tbl);
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['blog_analytics', 'blog_analytics_daily', 'blog_intelligence_settings', 'blog_post_likes', 'blog_relationships', 'blog_series', 'blog_series_posts', 'campaign_design_systems', 'company_blog_read_sessions', 'content_type', 'creator_template_collections', 'creator_user_template_versions', 'creator_user_templates'] LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('GRANT ALL ON TABLE public.%I TO anon, authenticated', t);
  END LOOP;
END $$;

-- TRUNCATE on every public table, as production held it before the fix.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.relname FROM pg_class c
            WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p') ORDER BY c.relname
  LOOP
    EXECUTE format('GRANT TRUNCATE ON TABLE public.%I TO anon, authenticated', r.relname);
  END LOOP;
END $$;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT TRUNCATE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO PUBLIC;

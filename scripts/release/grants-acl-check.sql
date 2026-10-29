-- ============================================================================
-- grants-acl-check.sql — READ-ONLY privilege / RLS / policy / realtime snapshot
-- for the four grant scopes in docs/release/grants-consumer-matrix.md:
--   fix3        20261212000000 (4 tables) + the out-of-repo `authenticated`
--               revoke on the 8 Phase-A content tables
--   close_anon  20261026000000_close_anon_rls_exposure.sql (#239)
--   stack       orchestration-engine-adapters: 20261127000000 + 20261226000000
--               … 20261231000010 (18 tables, 27 functions)
--   pr349       20261223000000 / 20261223000001 (PR #349)
--
-- FOR AN AUTHORIZED OPERATOR ONLY. Nothing here writes. It was syntax- and
-- result-validated only on a disposable NON-PRODUCTION PostgreSQL 17.6 copy
-- (bootstrap schema, NOT Supabase default privileges), never on production.
--
-- HOW TO RUN
--   psql (preferred; shows every row). The script sets its own output format
--   (unaligned, TAB-separated, header row, no footer), so no shell-specific
--   flags are needed and the same command works in bash and PowerShell:
--     psql "<operator-held URL>" -X -v ON_ERROR_STOP=1 -f scripts/release/grants-acl-check.sql > grants.tsv
--   TAB separation keeps `v` values containing `|` unambiguous, and two
--   snapshots diff line by line.
--   Supabase SQL Editor: the editor shows one result set. Run the single
--   `WITH … ORDER BY` statement below on its own (it is a pure SELECT); the
--   BEGIN READ ONLY / ROLLBACK wrapper is for psql.
--   Save the full output with the run timestamp; it is the production ACL
--   snapshot the matrix asks for.
--
-- OUTPUT: one result set, columns (section, scope, object, k, v), all text.
--   S1 roles          role attributes (BYPASSRLS etc.) of the API/admin roles;
--                     memberships IN the API roles and memberships HELD BY the
--                     API roles (admin/inherit/set options on PG16+ — a
--                     NOINHERIT membership is still usable via SET ROLE); one
--                     row per LOGIN role (candidate direct-database consumers)
--   S2 relation       exists / relkind / owner / RLS / FORCE RLS / raw relacl /
--                     policy count / reloptions (security_invoker for views)
--   S3 acl            aclexplode(relacl): one row per grantee+privilege
--                     (grantee 0 is printed as PUBLIC). A NULL relacl (the built-in
--                     owner-only default) has no S03 rows; S02 prints it.
--   S4 effective      has_table_privilege per role (public, anon,
--                     authenticated, service_role) — the privileges held,
--                     including through PUBLIC and role membership
--   S5 column_acl     column-level grants (attacl), which survive a table REVOKE
--   S6 policy         pg_policies rows (name, cmd, roles, permissive, using,
--                     with check)
--   S7 function       exists / SECURITY DEFINER / owner / proacl / EXECUTE
--                     per role
--   S8 default_acl    every pg_default_acl entry, exploded per grantee
--   S9 publication    publications, and every public table in any publication
--                     (in-scope objects are flagged)
--   S10 schema        USAGE on schema public per role
--   S11 sequence      public sequences on which anon/authenticated hold anything
--   S12 dependency    views/materialized views (any schema) that read an
--                     in-scope table, and policies (any schema, incl. storage)
--                     whose USING / WITH CHECK names an in-scope table — the
--                     indirect paths that revoking a table would break or that
--                     reach a table without naming it in an API path
--
-- Output is ordered by all five columns with COLLATE "C" and search_path is
-- pinned, so two runs on equal catalogs are byte-identical. Backslash,
-- newline, CR and TAB inside `v` (policy expressions in S06) are escaped as
-- \\ \n \r \t, the same way catalog-fingerprint.sql does, so every fact is
-- exactly one line.
-- ============================================================================

\set ON_ERROR_STOP on
\set QUIET on
\pset pager off
\pset footer off
\pset format unaligned
\pset fieldsep '\t'
\pset tuples_only off
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '2s';
SET LOCAL search_path = pg_catalog, pg_temp;

WITH
rel_objs(scope, name) AS (VALUES
    -- fix3: tables created by 20261212000000 (RLS + <t>_company_rw policy, no GRANT/REVOKE)
    ('fix3:table', 'content_quality'),
    ('fix3:table', 'content_block'),
    ('fix3:table', 'content_recommendation'),
    ('fix3:table', 'content_approval_history'),
    -- fix3: the 8 Phase-A tables whose `authenticated` grants were revoked out of repo
    ('fix3:phase_a_revoked', 'brand_memory'),
    ('fix3:phase_a_revoked', 'content'),
    ('fix3:phase_a_revoked', 'content_asset'),
    ('fix3:phase_a_revoked', 'content_memory'),
    ('fix3:phase_a_revoked', 'content_originality'),
    ('fix3:phase_a_revoked', 'content_revision'),
    ('fix3:phase_a_revoked', 'content_variant'),
    ('fix3:phase_a_revoked', 'publication_lineage'),
    -- fix3 dependency: every company_rw predicate reads this table
    ('fix3:dependency', 'user_company_roles'),
    -- stack: RLS on, NO explicit REVOKE (the candidates for remediation)
    ('stack:no_revoke', 'prospect_lists'),
    ('stack:no_revoke', 'prospect_list_members'),
    ('stack:no_revoke', 'prospect_campaigns'),
    ('stack:no_revoke', 'workflows'),
    ('stack:no_revoke', 'workflow_versions'),
    ('stack:no_revoke', 'execution_instances'),
    ('stack:no_revoke', 'execution_plans'),
    ('stack:no_revoke', 'execution_plan_steps'),
    ('stack:no_revoke', 'execution_tasks'),
    ('stack:no_revoke', 'outreach_bridge_handoffs'),
    -- stack: RLS on AND explicit REVOKE in-file
    ('stack:revoked', 'execution_engine_requests'),
    ('stack:revoked', 'prospect_campaign_lists'),
    ('stack:revoked', 'prospect_campaign_targets'),
    ('stack:revoked', 'community_action_journey_links'),
    ('stack:revoked', 'rpa_auth_token_redemptions'),
    ('stack:revoked', 'identity_verification_attestations'),
    ('stack:revoked', 'engagement_request_idempotency'),
    ('stack:revoked', 'rpa_session_invalidation_audit'),
    -- pr349
    ('pr349:table', 'customer_readiness_snapshots'),
    ('pr349:table', 'execution_approvals'),
    -- realtime consumer (browser postgres_changes) — control object
    ('control:realtime', 'credit_transactions'),
    -- close_anon (20261026000000): 177 + 9 + 4 tables, 29 + 8 views
    ('close_anon:rls_revoke', 'active_lead_runs'),
    ('close_anon:rls_revoke', 'active_leads'),
    ('close_anon:rls_revoke', 'adapter_configs'),
    ('close_anon:rls_revoke', 'ai_message_drafts'),
    ('close_anon:rls_revoke', 'alert_rules'),
    ('close_anon:rls_revoke', 'analyst_collection_items'),
    ('close_anon:rls_revoke', 'analytics_competitor_domains'),
    ('close_anon:rls_revoke', 'analytics_intelligence_snapshots'),
    ('close_anon:rls_revoke', 'analytics_materializations'),
    ('close_anon:rls_revoke', 'analytics_serp_acquisition_runs'),
    ('close_anon:rls_revoke', 'analytics_serp_provider_health'),
    ('close_anon:rls_revoke', 'analytics_serp_query_queue'),
    ('close_anon:rls_revoke', 'analytics_serp_results'),
    ('close_anon:rls_revoke', 'analytics_serp_snapshots'),
    ('close_anon:rls_revoke', 'analytics_warehouse_facts'),
    ('close_anon:rls_revoke', 'angle_industry_matrix'),
    ('close_anon:rls_revoke', 'audit_export_jobs'),
    ('close_anon:rls_revoke', 'auth_audit_logs'),
    ('close_anon:rls_revoke', 'author_identity_links'),
    ('close_anon:rls_revoke', 'billing_policy_config'),
    ('close_anon:rls_revoke', 'block_templates'),
    ('close_anon:rls_revoke', 'campaign_autonomous_learnings'),
    ('close_anon:rls_revoke', 'canonical_backlink_signals'),
    ('close_anon:rls_revoke', 'community_recommendations'),
    ('close_anon:rls_revoke', 'company_execution_config'),
    ('close_anon:rls_revoke', 'company_llm_configs'),
    ('close_anon:rls_revoke', 'company_scheduler_prefs'),
    ('close_anon:rls_revoke', 'company_settings'),
    ('close_anon:rls_revoke', 'company_setup_progress'),
    ('close_anon:rls_revoke', 'consent_records'),
    ('close_anon:rls_revoke', 'content_asset_attachment'),
    ('close_anon:rls_revoke', 'content_asset_platform_override'),
    ('close_anon:rls_revoke', 'content_core_asset'),
    ('close_anon:rls_revoke', 'content_external_video_asset'),
    ('close_anon:rls_revoke', 'copilot_responses'),
    ('close_anon:rls_revoke', 'cost_budgets'),
    ('close_anon:rls_revoke', 'cost_events'),
    ('close_anon:rls_revoke', 'cost_reconciliation_adjustments'),
    ('close_anon:rls_revoke', 'cost_reconciliation_runs'),
    ('close_anon:rls_revoke', 'creator_alert_state'),
    ('close_anon:rls_revoke', 'creator_audit_log'),
    ('close_anon:rls_revoke', 'creator_cron_lease'),
    ('close_anon:rls_revoke', 'creator_dead_letter_jobs'),
    ('close_anon:rls_revoke', 'creator_execution_audit_logs'),
    ('close_anon:rls_revoke', 'creator_execution_dead_letter_queue'),
    ('close_anon:rls_revoke', 'creator_execution_metrics'),
    ('close_anon:rls_revoke', 'creator_execution_summaries'),
    ('close_anon:rls_revoke', 'creator_operational_events'),
    ('close_anon:rls_revoke', 'creator_render_attempt'),
    ('close_anon:rls_revoke', 'creator_render_governance_state'),
    ('close_anon:rls_revoke', 'creator_render_job'),
    ('close_anon:rls_revoke', 'creator_render_job_events'),
    ('close_anon:rls_revoke', 'creator_render_job_state'),
    ('close_anon:rls_revoke', 'creator_render_jobs'),
    ('close_anon:rls_revoke', 'creator_render_metrics'),
    ('close_anon:rls_revoke', 'creator_render_moderation_event'),
    ('close_anon:rls_revoke', 'creator_render_ops_audit'),
    ('close_anon:rls_revoke', 'creator_render_output'),
    ('close_anon:rls_revoke', 'creator_render_provider'),
    ('close_anon:rls_revoke', 'creator_render_queue_job'),
    ('close_anon:rls_revoke', 'creator_render_validation_manifests'),
    ('close_anon:rls_revoke', 'creator_render_variant'),
    ('close_anon:rls_revoke', 'creator_template_registry'),
    ('close_anon:rls_revoke', 'creator_upload_rate_state'),
    ('close_anon:rls_revoke', 'customer_operations_scores'),
    ('close_anon:rls_revoke', 'customer_population_classification'),
    ('close_anon:rls_revoke', 'decision_priority_queue'),
    ('close_anon:rls_revoke', 'deployment_telemetry_snapshots'),
    ('close_anon:rls_revoke', 'earn_credit_actions'),
    ('close_anon:rls_revoke', 'engagement_identity_candidates'),
    ('close_anon:rls_revoke', 'escalations'),
    ('close_anon:rls_revoke', 'execution_observability_records'),
    ('close_anon:rls_revoke', 'execution_partitions'),
    ('close_anon:rls_revoke', 'external_api_assignments'),
    ('close_anon:rls_revoke', 'external_api_connections'),
    ('close_anon:rls_revoke', 'external_api_usage_logs'),
    ('close_anon:rls_revoke', 'feature_flags'),
    ('close_anon:rls_revoke', 'feedback_submissions'),
    ('close_anon:rls_revoke', 'free_credit_grants'),
    ('close_anon:rls_revoke', 'governance_audit_runs'),
    ('close_anon:rls_revoke', 'governance_convergence_scores'),
    ('close_anon:rls_revoke', 'governance_enforcement_events'),
    ('close_anon:rls_revoke', 'incident_events'),
    ('close_anon:rls_revoke', 'incident_timeline_entries'),
    ('close_anon:rls_revoke', 'incidents'),
    ('close_anon:rls_revoke', 'ingestion_throughput_state'),
    ('close_anon:rls_revoke', 'integration_activity_events'),
    ('close_anon:rls_revoke', 'integration_capabilities'),
    ('close_anon:rls_revoke', 'intelligence_company_overrides'),
    ('close_anon:rls_revoke', 'intelligence_execution_log'),
    ('close_anon:rls_revoke', 'intelligence_global_config'),
    ('close_anon:rls_revoke', 'intelligence_governance_policies'),
    ('close_anon:rls_revoke', 'intelligence_incidents'),
    ('close_anon:rls_revoke', 'intelligence_role_assignments'),
    ('close_anon:rls_revoke', 'intelligence_roles'),
    ('close_anon:rls_revoke', 'intelligence_throttle_config'),
    ('close_anon:rls_revoke', 'intent_savings_log'),
    ('close_anon:rls_revoke', 'investigation_workspace_items'),
    ('close_anon:rls_revoke', 'investigation_workspaces'),
    ('close_anon:rls_revoke', 'ip_org_creations'),
    ('close_anon:rls_revoke', 'job_idempotency_keys'),
    ('close_anon:rls_revoke', 'listening_configurations'),
    ('close_anon:rls_revoke', 'listening_executions'),
    ('close_anon:rls_revoke', 'listening_signal_dedup'),
    ('close_anon:rls_revoke', 'listening_sources'),
    ('close_anon:rls_revoke', 'llm_models'),
    ('close_anon:rls_revoke', 'llm_providers'),
    ('close_anon:rls_revoke', 'market_pulse_automation_settings'),
    ('close_anon:rls_revoke', 'market_pulse_finding_actions'),
    ('close_anon:rls_revoke', 'market_pulse_findings'),
    ('close_anon:rls_revoke', 'market_pulse_memory'),
    ('close_anon:rls_revoke', 'market_pulse_runs'),
    ('close_anon:rls_revoke', 'migration_dry_runs'),
    ('close_anon:rls_revoke', 'moderation_decisions'),
    ('close_anon:rls_revoke', 'monetization_beta_drills'),
    ('close_anon:rls_revoke', 'monetization_beta_orgs'),
    ('close_anon:rls_revoke', 'monetization_beta_support_actions'),
    ('close_anon:rls_revoke', 'monetization_beta_support_cases'),
    ('close_anon:rls_revoke', 'monetization_beta_users'),
    ('close_anon:rls_revoke', 'monitoring_runs'),
    ('close_anon:rls_revoke', 'observability_convergence_projections'),
    ('close_anon:rls_revoke', 'operational_safety_rail_events'),
    ('close_anon:rls_revoke', 'operational_safety_rails'),
    ('close_anon:rls_revoke', 'operator_actions'),
    ('close_anon:rls_revoke', 'opportunity_assignments'),
    ('close_anon:rls_revoke', 'opportunity_dispositions'),
    ('close_anon:rls_revoke', 'opportunity_feed_items'),
    ('close_anon:rls_revoke', 'opportunity_graph_edges'),
    ('close_anon:rls_revoke', 'opportunity_graph_nodes'),
    ('close_anon:rls_revoke', 'opportunity_lifecycle_states'),
    ('close_anon:rls_revoke', 'opportunity_notes'),
    ('close_anon:rls_revoke', 'opportunity_tags'),
    ('close_anon:rls_revoke', 'org_learning_metrics'),
    ('close_anon:rls_revoke', 'pending_invite_unlocks'),
    ('close_anon:rls_revoke', 'platform_cost_allocations'),
    ('close_anon:rls_revoke', 'platform_cost_categories'),
    ('close_anon:rls_revoke', 'platform_stabilization_events'),
    ('close_anon:rls_revoke', 'platform_stabilization_windows'),
    ('close_anon:rls_revoke', 'post_analytics_polls'),
    ('close_anon:rls_revoke', 'post_events'),
    ('close_anon:rls_revoke', 'production_certification_reports'),
    ('close_anon:rls_revoke', 'production_rollout_plans'),
    ('close_anon:rls_revoke', 'production_rollout_stage_executions'),
    ('close_anon:rls_revoke', 'projection_sync_state'),
    ('close_anon:rls_revoke', 'provider_invoice_imports'),
    ('close_anon:rls_revoke', 'referrals'),
    ('close_anon:rls_revoke', 'region_routing'),
    ('close_anon:rls_revoke', 'replay_operations'),
    ('close_anon:rls_revoke', 'replay_partitions'),
    ('close_anon:rls_revoke', 'report_automation_configs'),
    ('close_anon:rls_revoke', 'report_automation_events'),
    ('close_anon:rls_revoke', 'report_definitions'),
    ('close_anon:rls_revoke', 'report_executions'),
    ('close_anon:rls_revoke', 'report_notification_events'),
    ('close_anon:rls_revoke', 'resilience_advisory_plans'),
    ('close_anon:rls_revoke', 'resilience_validation_runs'),
    ('close_anon:rls_revoke', 'retention_executions'),
    ('close_anon:rls_revoke', 'retention_policies'),
    ('close_anon:rls_revoke', 'saved_intelligence_views'),
    ('close_anon:rls_revoke', 'semantic_index_entries'),
    ('close_anon:rls_revoke', 'semantic_indexing_jobs'),
    ('close_anon:rls_revoke', 'semantic_indexing_partitions'),
    ('close_anon:rls_revoke', 'semantic_retrieval_explanations'),
    ('close_anon:rls_revoke', 'signal_intent_clusters'),
    ('close_anon:rls_revoke', 'sla_breaches'),
    ('close_anon:rls_revoke', 'source_health_states'),
    ('close_anon:rls_revoke', 'sre_health_snapshots'),
    ('close_anon:rls_revoke', 'support_snapshots'),
    ('close_anon:rls_revoke', 'system_anomalies'),
    ('close_anon:rls_revoke', 'system_health_metrics'),
    ('close_anon:rls_revoke', 'tenant_onboarding_runtime_stages'),
    ('close_anon:rls_revoke', 'token_refresh_locks'),
    ('close_anon:rls_revoke', 'unified_person_merges'),
    ('close_anon:rls_revoke', 'whatsapp_broadcast_recipients'),
    ('close_anon:rls_revoke', 'whatsapp_broadcasts'),
    ('close_anon:rls_revoke', 'whatsapp_media_cache'),
    ('close_anon:rls_revoke', 'whatsapp_templates'),
    ('close_anon:policy_retargeted', 'blog_analytics'),
    ('close_anon:policy_retargeted', 'blog_analytics_daily'),
    ('close_anon:policy_retargeted', 'blog_intelligence_settings'),
    ('close_anon:policy_retargeted', 'blog_post_likes'),
    ('close_anon:policy_retargeted', 'campaign_design_systems'),
    ('close_anon:policy_retargeted', 'company_blog_read_sessions'),
    ('close_anon:policy_retargeted', 'creator_template_collections'),
    ('close_anon:policy_retargeted', 'creator_user_template_versions'),
    ('close_anon:policy_retargeted', 'creator_user_templates'),
    ('close_anon:public_read', 'blog_relationships'),
    ('close_anon:public_read', 'blog_series'),
    ('close_anon:public_read', 'blog_series_posts'),
    ('close_anon:public_read', 'content_type'),
    ('close_anon:owner_view', 'ai_suggestion_acceptance_rate'),
    ('close_anon:owner_view', 'canonical_campaign_entities'),
    ('close_anon:owner_view', 'canonical_company_entities'),
    ('close_anon:owner_view', 'community_ai_execution_success_rate'),
    ('close_anon:owner_view', 'company_blog_performance_summary'),
    ('close_anon:owner_view', 'company_financial_reconciliation'),
    ('close_anon:owner_view', 'cost_margin_daily_view'),
    ('close_anon:owner_view', 'cost_monitoring_daily_view'),
    ('close_anon:owner_view', 'deep_view'),
    ('close_anon:owner_view', 'free_credits_activity'),
    ('close_anon:owner_view', 'growth_view'),
    ('close_anon:owner_view', 'identity_health_metrics'),
    ('close_anon:owner_view', 'market_pulse_latest_run_view'),
    ('close_anon:owner_view', 'org_economics_view'),
    ('close_anon:owner_view', 'pricing_health_view'),
    ('close_anon:owner_view', 'retention_candidates'),
    ('close_anon:owner_view', 'snapshot_view'),
    ('close_anon:owner_view', 'unified_transactions_with_anomalies_view'),
    ('close_anon:owner_view', 'v_approval_health'),
    ('close_anon:owner_view', 'v_billing_operations_health'),
    ('close_anon:owner_view', 'v_company_financial_timeline'),
    ('close_anon:owner_view', 'v_finance_role_holders'),
    ('close_anon:owner_view', 'v_pricing_catalog'),
    ('close_anon:owner_view', 'v_reservation_health'),
    ('close_anon:owner_view', 'vw_company_report_stats'),
    ('close_anon:owner_view', 'vw_feature_completion_summary'),
    ('close_anon:owner_view', 'vw_free_reports_by_domain'),
    ('close_anon:owner_view', 'weekly_alignment_summary'),
    ('close_anon:owner_view', 'weekly_refinement_status'),
    ('close_anon:invoker_view', 'blog_performance_summary'),
    ('close_anon:invoker_view', 'campaign_insights_view'),
    ('close_anon:invoker_view', 'community_ai_network_intelligence'),
    ('close_anon:invoker_view', 'content_opportunities_view'),
    ('close_anon:invoker_view', 'engagement_insights_view'),
    ('close_anon:invoker_view', 'lead_intelligence_view'),
    ('close_anon:invoker_view', 'market_pulse_view'),
    ('close_anon:invoker_view', 'omnivyra_decision_feature_base_view')
),
-- Functions by NAME (all overloads) for fix3/stack; by exact signature for close_anon.
fn_name_objs(scope, name) AS (VALUES
    ('fix3:function', 'set_content_updated_at'),
    ('fix3:function', 'omnivyra_touch_updated_at'),
    ('stack:function', 'prospect_campaigns_guard'),
    ('stack:function', 'workflows_guard'),
    ('stack:function', 'workflow_versions_guard_immutable'),
    ('stack:function', 'publish_workflow_version'),
    ('stack:function', 'execution_instances_guard'),
    ('stack:function', 'create_execution_instance'),
    ('stack:function', 'execution_plans_guard'),
    ('stack:function', 'execution_plan_steps_guard'),
    ('stack:function', 'execution_tasks_guard'),
    ('stack:function', 'create_execution_plan'),
    ('stack:function', 'execution_step_anchor'),
    ('stack:function', 'advance_execution_plan'),
    ('stack:function', 'cancel_execution_run'),
    ('stack:function', 'outreach_bridge_handoffs_guard'),
    ('stack:function', 'bridge_execution_task'),
    ('stack:function', 'execution_engine_requests_guard'),
    ('stack:function', 'prospect_campaigns_targeting_guard'),
    ('stack:function', 'prospect_campaign_targets_guard'),
    ('stack:function', 'community_action_journey_links_guard'),
    ('stack:function', 'reap_community_ai_action_leases'),
    ('stack:function', 'claim_community_ai_browser_command'),
    ('stack:function', 'record_community_ai_late_dispatch_result'),
    ('stack:function', 'community_identity_normalize_external_id'),
    ('stack:function', 'community_action_journey_links_identity_guard'),
    ('stack:function', 'identity_verification_attestations_guard'),
    ('stack:function', 'community_action_journey_links_identity_proof_guard'),
    ('stack:function', 'community_ai_actions_reap_uncertain_guard')
),
fn_sig_objs(scope, sig) AS (VALUES
    ('close_anon:definer_fn', 'public.activate_invitation_membership(uuid,uuid,timestamp with time zone)'),
    ('close_anon:definer_fn', 'public.admin_override_community_ai_status(uuid,text,text,uuid)'),
    ('close_anon:definer_fn', 'public.apply_credit_transaction_v2(uuid,text,integer,numeric,text,text,text,uuid,text,text,uuid,text,jsonb)'),
    ('close_anon:definer_fn', 'public.auth_user_confirmed(text)'),
    ('close_anon:definer_fn', 'public.auth_user_has_password(uuid)'),
    ('close_anon:definer_fn', 'public.claim_email_jobs(text,integer)'),
    ('close_anon:definer_fn', 'public.configure_domain_reminder_cron(text,text)'),
    ('close_anon:definer_fn', 'public.delete_intelligence_signals_older_than_365_days()'),
    ('close_anon:definer_fn', 'public.disable_company_cascade(uuid,uuid,text)'),
    ('close_anon:definer_fn', 'public.finalize_email_job(uuid,text,text,text,timestamp with time zone)'),
    ('close_anon:definer_fn', 'public.flush_community_ai_metric_dlq(integer)'),
    ('close_anon:definer_fn', 'public.get_usage_report(uuid,uuid,text,text,text,text,timestamp with time zone,timestamp with time zone,boolean)'),
    ('close_anon:definer_fn', 'public.image_metadata_append_query(text[],text)'),
    ('close_anon:definer_fn', 'public.increment_automation_usage_if_allowed(uuid,integer)'),
    ('close_anon:definer_fn', 'public.increment_bolt_run_progress(uuid,integer,integer,integer,integer)'),
    ('close_anon:definer_fn', 'public.increment_usage_meter(uuid,integer,integer,bigint,bigint,bigint,bigint,bigint,numeric)'),
    ('close_anon:definer_fn', 'public.invalidate_user_sessions(uuid,text)'),
    ('close_anon:definer_fn', 'public.meta_oauth_apply(jsonb,jsonb,jsonb,jsonb)'),
    ('close_anon:definer_fn', 'public.omnivyra_upsert_behavioral_analytics(jsonb,jsonb)'),
    ('close_anon:definer_fn', 'public.prune_rpa_artifacts(integer)'),
    ('close_anon:definer_fn', 'public.reap_community_ai_action_leases()'),
    ('close_anon:definer_fn', 'public.record_email_event(uuid,text,jsonb,text)'),
    ('close_anon:definer_fn', 'public.refresh_community_ai_execution_metrics_daily(integer)'),
    ('close_anon:definer_fn', 'public.security_create_secret(text,text,text)'),
    ('close_anon:definer_fn', 'public.security_delete_secret(uuid)'),
    ('close_anon:definer_fn', 'public.security_get_secret(uuid)'),
    ('close_anon:definer_fn', 'public.soft_delete_company(uuid,uuid,text)'),
    ('close_anon:definer_fn', 'public.trigger_domain_reminder_cron()'),
    ('close_anon:definer_fn', 'public.trigger_recover_stale_reports_cron()')
),
rels AS (
  SELECT o.scope, o.name, to_regclass(format('public.%I', o.name)) AS rid
    FROM rel_objs o
),
fns AS (
  SELECT o.scope, coalesce(p.oid::regprocedure::text, o.name || ' (absent)') AS name, p.oid AS fid
    FROM fn_name_objs o
    LEFT JOIN pg_proc p ON p.proname = o.name AND p.pronamespace = 'public'::regnamespace
  UNION ALL
  SELECT o.scope, o.sig, to_regprocedure(o.sig)::oid
    FROM fn_sig_objs o
),
check_roles(r) AS (VALUES ('public'), ('anon'), ('authenticated'), ('service_role')),
privs(p) AS (
  SELECT unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'])
  UNION ALL
  SELECT 'MAINTAIN' WHERE current_setting('server_version_num')::int >= 170000
),
out(section, scope, object, k, v) AS (
  -- S01 roles
  SELECT 'S01_roles', '-', r.rolname::text, 'attrs',
         format('super=%s bypassrls=%s inherit=%s login=%s', r.rolsuper, r.rolbypassrls, r.rolinherit, r.rolcanlogin)
    FROM pg_roles r
   WHERE r.rolname IN ('anon', 'authenticated', 'service_role', 'postgres', 'authenticator', 'supabase_admin')
  UNION ALL
  -- members OF an API role (options read via to_jsonb so the query also runs before PG16)
  SELECT 'S01_roles', '-', m.member::regrole::text, 'member_of',
         m.roleid::regrole::text || format(' admin=%s inherit=%s set=%s', m.admin_option,
           coalesce(to_jsonb(m) ->> 'inherit_option', 'n/a'), coalesce(to_jsonb(m) ->> 'set_option', 'n/a'))
    FROM pg_auth_members m
   WHERE m.roleid::regrole::text IN ('anon', 'authenticated', 'service_role')
  UNION ALL
  -- memberships HELD BY an API role (e.g. GRANT <x> TO authenticated)
  SELECT 'S01_roles', '-', m.member::regrole::text, 'has_membership_in',
         m.roleid::regrole::text || format(' admin=%s inherit=%s set=%s', m.admin_option,
           coalesce(to_jsonb(m) ->> 'inherit_option', 'n/a'), coalesce(to_jsonb(m) ->> 'set_option', 'n/a'))
    FROM pg_auth_members m
   WHERE m.member::regrole::text IN ('anon', 'authenticated', 'service_role')
  UNION ALL
  -- every LOGIN role: candidate direct-database consumers (names/attributes only)
  SELECT 'S01_roles', '-', r.rolname::text, 'login_role',
         format('super=%s bypassrls=%s createrole=%s createdb=%s replication=%s conn_limit=%s valid_until=%s',
                r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb, r.rolreplication,
                r.rolconnlimit, coalesce(r.rolvaliduntil::text, '-'))
    FROM pg_roles r
   WHERE r.rolcanlogin
  UNION ALL
  -- S02 relation
  SELECT 'S02_relation', x.scope, x.name, 'state',
         CASE WHEN x.rid IS NULL THEN 'ABSENT'
              ELSE format('relkind=%s owner=%s rls=%s force_rls=%s policies=%s relacl=%s reloptions=%s',
                          c.relkind, pg_get_userbyid(c.relowner), c.relrowsecurity, c.relforcerowsecurity,
                          (SELECT count(*) FROM pg_policy pp WHERE pp.polrelid = c.oid),
                          coalesce(c.relacl::text, 'NULL(owner-only built-in default)'),
                          coalesce(c.reloptions::text, '-'))
         END
    FROM rels x LEFT JOIN pg_class c ON c.oid = x.rid
  UNION ALL
  -- S03 acl, one row per grantee (PUBLIC for grantee 0)
  SELECT 'S03_acl', x.scope, x.name,
         CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
         string_agg(a.privilege_type || CASE WHEN a.is_grantable THEN '*' ELSE '' END, ',' ORDER BY a.privilege_type)
         || ' (grantor ' || string_agg(DISTINCT pg_get_userbyid(a.grantor), ',' ORDER BY pg_get_userbyid(a.grantor)) || ')'
    FROM rels x JOIN pg_class c ON c.oid = x.rid
    CROSS JOIN LATERAL aclexplode(c.relacl) a
   GROUP BY x.scope, x.name, a.grantee
  UNION ALL
  -- S04 effective table privileges per role
  SELECT 'S04_effective', x.scope, x.name, cr.r,
         coalesce(string_agg(pv.p, ',' ORDER BY pv.p) FILTER (WHERE has_table_privilege(cr.r, x.rid, pv.p)), 'NONE')
    FROM rels x CROSS JOIN check_roles cr CROSS JOIN privs pv
   WHERE x.rid IS NOT NULL
   GROUP BY x.scope, x.name, cr.r
  UNION ALL
  -- S05 column-level grants
  SELECT 'S05_column_acl', x.scope, x.name || '.' || att.attname,
         CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
         a.privilege_type
    FROM rels x JOIN pg_attribute att ON att.attrelid = x.rid AND att.attnum > 0 AND NOT att.attisdropped
    CROSS JOIN LATERAL aclexplode(att.attacl) a
   WHERE att.attacl IS NOT NULL
  UNION ALL
  -- S06 policies
  SELECT 'S06_policy', x.scope, x.name || '.' || pol.policyname,
         format('cmd=%s permissive=%s roles=%s', pol.cmd, pol.permissive, pol.roles::text),
         format('using=%s | with_check=%s', coalesce(pol.qual, '-'), coalesce(pol.with_check, '-'))
    FROM rels x JOIN pg_policies pol ON pol.schemaname = 'public' AND pol.tablename = x.name
  UNION ALL
  -- S07 functions
  SELECT 'S07_function', f.scope, f.name, 'state',
         CASE WHEN f.fid IS NULL THEN 'ABSENT'
              ELSE format('secdef=%s owner=%s proacl=%s', p.prosecdef, pg_get_userbyid(p.proowner),
                          coalesce(p.proacl::text, 'NULL(built-in default: PUBLIC EXECUTE)'))
         END
    FROM fns f LEFT JOIN pg_proc p ON p.oid = f.fid
  UNION ALL
  SELECT 'S07_function', f.scope, f.name, 'execute:' || cr.r,
         has_function_privilege(cr.r, f.fid, 'EXECUTE')::text
    FROM fns f CROSS JOIN check_roles cr
   WHERE f.fid IS NOT NULL
  UNION ALL
  -- S08 default privileges (entries are deltas against the built-in defaults)
  SELECT 'S08_default_acl', '-',
         format('for_role=%s schema=%s objtype=%s', pg_get_userbyid(d.defaclrole),
                coalesce(nullif(d.defaclnamespace, 0::oid)::regnamespace::text, '<global>'), d.defaclobjtype),
         CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
         string_agg(a.privilege_type, ',' ORDER BY a.privilege_type)
    FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
   GROUP BY d.defaclrole, d.defaclnamespace, d.defaclobjtype, a.grantee
  UNION ALL
  SELECT 'S08_default_acl', '-',
         format('for_role=%s schema=%s objtype=%s', pg_get_userbyid(d.defaclrole),
                coalesce(nullif(d.defaclnamespace, 0::oid)::regnamespace::text, '<global>'), d.defaclobjtype),
         'raw', d.defaclacl::text
    FROM pg_default_acl d
  UNION ALL
  -- S09 realtime / logical replication publications
  SELECT 'S09_publication', '-', pb.pubname::text, 'publication',
         format('all_tables=%s insert=%s update=%s delete=%s truncate=%s', pb.puballtables, pb.pubinsert,
                pb.pubupdate, pb.pubdelete, pb.pubtruncate)
    FROM pg_publication pb
  UNION ALL
  SELECT 'S09_publication', coalesce((SELECT string_agg(DISTINCT x.scope, ',' ORDER BY x.scope) FROM rels x WHERE x.name = pt.tablename), 'not-in-scope'),
         pt.pubname::text, 'table', pt.schemaname || '.' || pt.tablename
    FROM pg_publication_tables pt
   WHERE pt.schemaname = 'public'
  UNION ALL
  -- S10 schema usage
  SELECT 'S10_schema', '-', 'public', 'usage:' || cr.r, has_schema_privilege(cr.r, 'public', 'USAGE')::text
    FROM check_roles cr
  UNION ALL
  -- S11 sequences readable/usable by anon/authenticated
  SELECT 'S11_sequence', '-', s.relname::text, cr.r,
         concat_ws(',',
           CASE WHEN has_sequence_privilege(cr.r, s.oid, 'USAGE') THEN 'USAGE' END,
           CASE WHEN has_sequence_privilege(cr.r, s.oid, 'SELECT') THEN 'SELECT' END,
           CASE WHEN has_sequence_privilege(cr.r, s.oid, 'UPDATE') THEN 'UPDATE' END)
    FROM pg_class s CROSS JOIN (VALUES ('anon'), ('authenticated')) cr(r)
   WHERE s.relnamespace = 'public'::regnamespace AND s.relkind = 'S'
     AND has_sequence_privilege(cr.r, s.oid, 'USAGE,SELECT,UPDATE')
  UNION ALL
  -- S12 dependencies: views / materialized views (any schema) whose rewrite
  -- rule depends on an in-scope table
  SELECT DISTINCT 'S12_dependency', x.scope, x.name,
         'read_by_' || CASE v.relkind WHEN 'm' THEN 'matview' ELSE 'view' END,
         v.relnamespace::regnamespace::text || '.' || v.relname
    FROM rels x
    JOIN pg_depend d ON d.refclassid = 'pg_class'::regclass AND d.refobjid = x.rid
                    AND d.classid = 'pg_rewrite'::regclass
    JOIN pg_rewrite rw ON rw.oid = d.objid
    JOIN pg_class v ON v.oid = rw.ev_class AND v.oid <> x.rid
   WHERE x.rid IS NOT NULL
  UNION ALL
  -- S12 dependencies: policies (any schema, incl. storage) whose expression
  -- names an in-scope table (word match on the table name; review each row)
  SELECT DISTINCT 'S12_dependency', x.scope, x.name, 'named_in_policy',
         pol.schemaname || '.' || pol.tablename || '.' || pol.policyname
    FROM rels x
    JOIN pg_policies pol
      ON NOT (pol.schemaname = 'public' AND pol.tablename = x.name)
     AND (coalesce(pol.qual, '') ~ ('\m' || x.name || '\M')
          OR coalesce(pol.with_check, '') ~ ('\m' || x.name || '\M'))
   WHERE x.rid IS NOT NULL
)
SELECT section, scope, object, k,
       replace(replace(replace(replace(v, '\', '\\'), E'\n', '\n'), E'\r', '\r'), E'\t', '\t') AS v
  FROM out
 ORDER BY section COLLATE "C", scope COLLATE "C", object COLLATE "C", k COLLATE "C", v COLLATE "C";

ROLLBACK;

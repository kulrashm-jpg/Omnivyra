-- ─────────────────────────────────────────────────────────────────────────────
-- Enable RLS on all public tables + fix SECURITY DEFINER views
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Context:
--   All API access in this application uses the service-role key, which
--   bypasses RLS by default (BYPASSRLS privilege). Enabling RLS without adding
--   permissive policies therefore has NO effect on existing backend operations
--   while closing direct PostgREST access via anon/authenticated keys.
--
--   The three "sensitive columns exposed" issues (access_token, refresh_token,
--   session_id) are resolved as a side-effect: those tables are included below.
--
-- SECURITY DEFINER views:
--   In PostgreSQL 15+ (Supabase default) views respect the row-level security
--   policies of the *querying* user by default (security_invoker = true).
--   Views created with security_invoker = false enforce the *definer's*
--   permissions, bypassing RLS for the querying user. We correct both views.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Fix SECURITY DEFINER views ────────────────────────────────────────────

ALTER VIEW public.blog_performance_summary
  SET (security_invoker = true);

ALTER VIEW public.community_ai_network_intelligence
  SET (security_invoker = true);

-- ── 2. Enable RLS on every flagged table ─────────────────────────────────────
-- Using DO block so that tables which already have RLS enabled are skipped
-- gracefully (ALTER TABLE ... ENABLE ROW LEVEL SECURITY is idempotent in
-- PostgreSQL 16+, but the DO block provides a safety net for older versions).

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    -- Core user / company / auth
    'users',
    'user_company_roles',
    'companies',
    'company_profiles',
    'company_profile_refinements',
    'invitations',
    'social_accounts',
    'api_integrations',

    -- Campaigns
    'campaigns',
    'campaign_analytics',
    'campaign_cost_breakdown',
    'campaign_execution_state',
    'campaign_forecasts',
    'campaign_goals',
    'campaign_governance_events',
    'campaign_health_reports',
    'campaign_learnings',
    'campaign_memory_snapshots',
    'campaign_messages',
    'campaign_narratives',
    'campaign_opportunities',
    'campaign_performance_metrics',
    'campaign_performance_signals',
    'campaign_planning_inputs',
    'campaign_preemption_log',
    'campaign_proposals',
    'campaign_readiness',
    'campaign_recommendation_weeks',
    'campaign_resource_projection',
    'campaign_strategic_insights',
    'campaign_strategic_memory',
    'campaign_strategies',
    'campaign_strategy_memory',
    'campaign_team_assignment',
    'campaign_user_roles',
    'campaign_virality_assessments',
    'campaign_activity_engagement_signals',
    'campaign_activity_engagement_signals_archive',

    -- Content
    'content_analytics',
    'content_assets',
    'content_asset_versions',
    'content_items',
    'content_opportunities',
    'content_performance_metrics',
    'content_pillars',
    'content_plans',
    'content_reviews',
    'content_similarity_checks',
    'content_templates',
    'content_templates_enhanced',
    'daily_content_plans',

    -- Scheduling / posts
    'scheduled_posts',
    'scheduled_post_media',
    'recurring_posts',
    'calendar_events_index',
    'calendar_messages',
    'schedule_reviews',

    -- Teams
    'teams',
    'team_capacity',

    -- Activity / logs
    'activity_logs',
    'activity_metrics',
    'activity_feed',
    'activity_messages',
    'activity_error_log',

    -- Intelligence
    'intelligence_alerts',
    'intelligence_categories',
    'intelligence_cleanup_progress',
    'intelligence_events',
    'intelligence_graph_edges',
    'intelligence_job_runs',
    'intelligence_optimization_metrics',
    'intelligence_query_templates',
    'intelligence_signals',
    'intelligence_simulation_runs',
    'signal_clusters',
    'signal_companies',
    'signal_influencers',
    'signal_intelligence',
    'signal_keywords',
    'signal_topics',
    'strategic_themes',
    'strategic_memory',
    'strategic_memory_snapshots',

    -- Company intelligence
    'company_intelligence_competitors',
    'company_intelligence_keywords',
    'company_intelligence_products',
    'company_intelligence_regions',
    'company_intelligence_signals',
    'company_intelligence_topics',
    'company_strategic_themes',
    'company_theme_performance',
    'company_theme_state',
    'company_platform_performance',
    'company_content_type_performance',
    'company_api_configs',
    'theme_company_relevance',

    -- Engagement
    'engagement_authors',
    'engagement_content_opportunities',
    'engagement_daily_digest',
    'engagement_insight_evidence',
    'engagement_insights',
    'engagement_lead_signals',
    'engagement_message_intelligence',
    'engagement_messages',
    'engagement_opportunities',
    'engagement_rules',
    'engagement_signals',
    'engagement_sources',
    'engagement_system_controls',
    'engagement_thread_intelligence',
    'engagement_thread_memory',
    'engagement_threads',

    -- Community
    'community_posts',
    'community_threads',
    'post_comments',
    'comment_replies',
    'comment_likes',
    'comment_flags',
    'direct_messages',
    'message_replies',

    -- Community AI
    'community_ai_action_logs',
    'community_ai_actions',
    'community_ai_auto_rules',
    'community_ai_discovered_users',
    'community_ai_network_intelligence',
    'community_ai_notifications',
    'community_ai_platform_policy',
    'community_ai_platform_tokens',
    'community_ai_playbooks',
    'community_ai_webhooks',

    -- Recommendations
    'recommendation_analysis',
    'recommendation_audit_logs',
    'recommendation_jobs',
    'recommendation_jobs_v2',
    'recommendation_policies',
    'recommendation_raw_signals',
    'recommendation_snapshots',
    'recommendation_user_state',

    -- Opportunities / leads
    'opportunity_engine_errors',
    'opportunity_items',
    'opportunity_learning_metrics',
    'opportunity_radar',
    'opportunity_reports',
    'opportunity_to_campaign',
    'leads',
    'lead_intent_clusters_v1',
    'lead_jobs_v1',
    'lead_outreach_plans',
    'lead_platform_stats_v1',
    'lead_signals_v1',
    'lead_thread_recompute_queue',
    'lead_thread_score_cache',
    'buyer_intent_accounts',
    'influencer_intelligence',
    'feedback_intelligence',

    -- Plans & credits
    'plan_limits',
    'pricing_plans',
    'organization_credits',
    'organization_plan_assignments',
    'organization_plan_overrides',
    'credit_transactions',
    'free_credit_config',
    'provisioned_resources',

    -- Usage / billing
    'usage_events',
    'usage_meter_monthly',
    'usage_report_access',
    'usage_threshold_alerts',
    'external_api_usage',
    'external_api_health',
    'external_api_sources',
    'external_api_source_requests',
    'external_api_user_access',

    -- Platform
    'platform_compliance_reports',
    'platform_configurations',
    'platform_content_rules',
    'platform_content_variants',
    'platform_execution_plans',
    'platform_master',
    'platform_metrics_snapshots',
    'platform_oauth_configs',
    'platform_performance',
    'platform_post_metadata_requirements',
    'platform_rules',
    'platform_strategies',

    -- Analytics / reports
    'analytics_reports',
    'audience_insights',
    'business_intelligence_reports',
    'competitor_analysis',
    'governance_projections',
    'governance_snapshots',
    'hashtag_performance',
    'market_analyses',
    'market_pulse_items_v1',
    'market_pulse_jobs_v1',
    'optimal_posting_times',
    'outreach_plans',
    'performance_feedback',
    'platform_configurations',
    'roi_analysis',
    'roi_reports',
    'trend_snapshots',
    'virality_playbooks',

    -- AI / ML
    'ai_content_analysis',
    'ai_enhancement_logs',
    'ai_feedback',
    'ai_improvements',
    'ai_threads',
    'marketing_memory',
    'optimization_history',

    -- Planning
    'collaboration_plans',
    'content_opportunities',
    'execution_guardrails',
    'learning_insights',
    'outreach_plans',
    'promotion_metadata',
    'seven_days_plan',
    'twelve_week_plan',
    'voice_notes',
    'week_versions',
    'weekly_content_refinements',

    -- Queue / jobs / scheduler
    'queue_job_logs',
    'queue_jobs',
    'scheduler_jobs',
    'scheduler_locks',
    'worker_dead_letter_queue',
    'conversation_memory_rebuild_queue',

    -- Blogs / media
    'blogs',
    'media_files',

    -- Misc
    'forms',
    'bolt_execution_events',
    'bolt_execution_runs',
    'campaign_strategic_memory',
    'omni_lead_thread_recompute_queue',
    'omnivyra_hook_scores',
    'omnivyra_learning_events',
    'omnivyra_platform_scores',
    'omnivyra_trend_rankings',
    'response_performance_metrics',
    'response_reply_intelligence',
    'system_settings',
    'user_friendly_error_mappings',
    'webhook_logs'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- Only run if the table exists in public schema
    IF EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = t
        AND c.relkind = 'r'
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;
END;
$$;

-- ── 3. Grant no additional policies ──────────────────────────────────────────
-- The service_role has BYPASSRLS and continues to have full access.
-- No anon/authenticated policies are added — direct PostgREST access to these
-- tables is intentionally blocked. All app data access goes through Next.js
-- API routes that use the service-role key.

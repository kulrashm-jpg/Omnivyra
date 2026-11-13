-- Rollback of 20270217000046_action_pricing_owner_rule_15x.sql (e1).
-- For each of its 45 keys: deactivate the 046 row (effective_from 2026-11-14 00:00:00+00) and re-activate the key's most recent EARLIER
-- row, if it has one. The 21 keys that had no token row before 046 end with none - their fixed credit_cost_config price
-- was never changed.
DO $rb$
DECLARE
  k text;
  v_prev uuid;
BEGIN
  FOREACH k IN ARRAY ARRAY['ai_reply', 'async_campaign_planning', 'blogAnalyticsInsight', 'blog_brief_suggestions', 'blog_generation', 'blog_rewrite_hook', 'campaign_chat', 'campaign_creation', 'campaign_generation', 'campaign_optimization', 'campaign_preplanning', 'campaign_suggest_duration', 'campaign_suggest_update', 'chat_theme_refine', 'competitor_signals', 'content_basic', 'content_generation', 'content_repurpose', 'content_rewrite', 'content_suggestions', 'creator_content', 'daily_insight_scan', 'engagement_refine', 'insight_generation', 'lead_detection', 'lead_predictive_scoring', 'lead_qualification', 'market_insight_manual', 'market_positioning', 'optimization_loop', 'pattern_detection', 'portfolio_decision', 'prediction', 'profile_enrichment', 'profile_extraction', 'quick_platform_adapt', 'recommendations_generate', 'recommendations_group_preview', 'recommendations_opportunities', 'recommendations_preview_strategy', 'reply_generation', 'skeleton_command', 'strategy_evolution', 'system', 'trend_analysis'] LOOP
    UPDATE public.action_pricing_config SET is_active = false
     WHERE action_key = k AND is_active AND effective_from = '2026-11-14 00:00:00+00';
    v_prev := NULL;
    SELECT id INTO v_prev FROM public.action_pricing_config
     WHERE action_key = k AND effective_from < '2026-11-14 00:00:00+00'
     ORDER BY effective_from DESC, created_at DESC LIMIT 1;
    IF v_prev IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.action_pricing_config WHERE action_key = k AND is_active) THEN
      UPDATE public.action_pricing_config SET is_active = true WHERE id = v_prev;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.action_pricing_config WHERE is_active AND effective_from = '2026-11-14 00:00:00+00') THEN
    RAISE EXCEPTION '046 rollback: a 046 row is still active';
  END IF;
END
$rb$;

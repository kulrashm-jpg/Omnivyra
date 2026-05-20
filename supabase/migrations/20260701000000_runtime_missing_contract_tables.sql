-- Reconciles runtime-referenced local SQL contracts that were present in
-- database/*.sql but missing from the Supabase production schema.

BEGIN;

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID NULL,
  action TEXT NULL,
  target_user_id UUID NULL,
  company_id UUID NULL,
  metadata JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  operation TEXT NULL,
  table_name TEXT NULL,
  user_id UUID NULL,
  record_ids UUID[] NULL,
  success BOOLEAN NULL,
  error_message TEXT NULL,
  duration_ms INTEGER NULL,
  "timestamp" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_company_created
  ON public.audit_logs(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_created
  ON public.audit_logs(actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_operation_timestamp
  ON public.audit_logs(operation, "timestamp" DESC)
  WHERE operation IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.campaign_distribution_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL,
  week_number INTEGER NOT NULL,
  resolved_strategy TEXT NOT NULL,
  auto_detected BOOLEAN NOT NULL DEFAULT false,
  quality_override BOOLEAN NOT NULL DEFAULT false,
  slot_optimization_applied BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_distribution_campaign_week
  ON public.campaign_distribution_decisions(campaign_id, week_number);

CREATE TABLE IF NOT EXISTS public.campaign_plan_jobs (
  id TEXT PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  partial_result JSONB NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS campaign_plan_jobs_campaign_idx
  ON public.campaign_plan_jobs(campaign_id);
CREATE INDEX IF NOT EXISTS campaign_plan_jobs_status_idx
  ON public.campaign_plan_jobs(status);

CREATE TABLE IF NOT EXISTS public.campaign_preemption_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  initiator_campaign_id UUID NOT NULL REFERENCES public.campaigns(id),
  target_campaign_id UUID NOT NULL REFERENCES public.campaigns(id),
  status VARCHAR(20) DEFAULT 'PENDING',
  requested_at TIMESTAMPTZ DEFAULT now(),
  approved_at TIMESTAMPTZ NULL,
  rejected_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_preemption_requests_initiator
  ON public.campaign_preemption_requests(initiator_campaign_id);
CREATE INDEX IF NOT EXISTS idx_preemption_requests_target
  ON public.campaign_preemption_requests(target_campaign_id);
CREATE INDEX IF NOT EXISTS idx_preemption_requests_status
  ON public.campaign_preemption_requests(status);

CREATE TABLE IF NOT EXISTS public.campaign_readiness_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name TEXT NOT NULL,
  website_url TEXT NOT NULL,
  email TEXT NULL,
  score INTEGER NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_readiness_leads_user_id
  ON public.campaign_readiness_leads(user_id);
CREATE INDEX IF NOT EXISTS idx_campaign_readiness_leads_created_at
  ON public.campaign_readiness_leads(created_at);
CREATE INDEX IF NOT EXISTS idx_campaign_readiness_leads_email
  ON public.campaign_readiness_leads(email)
  WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.engagement_thread_classification (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  thread_id UUID NOT NULL REFERENCES public.engagement_threads(id) ON DELETE CASCADE,
  classification_category TEXT NOT NULL,
  classification_confidence NUMERIC NULL,
  sentiment TEXT NULL,
  triage_priority INTEGER DEFAULT 0,
  classified_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_thread_classification_thread
  ON public.engagement_thread_classification(thread_id);
CREATE INDEX IF NOT EXISTS idx_thread_classification_org
  ON public.engagement_thread_classification(organization_id);
CREATE INDEX IF NOT EXISTS idx_thread_classification_priority
  ON public.engagement_thread_classification(triage_priority DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_thread_classification_thread_org
  ON public.engagement_thread_classification(thread_id, organization_id);

CREATE TABLE IF NOT EXISTS public.image_metadata (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id TEXT NOT NULL,
  source TEXT NOT NULL,
  thumb_url TEXT NOT NULL,
  full_url TEXT NOT NULL,
  alt_text TEXT NULL,
  width INTEGER NULL,
  height INTEGER NULL,
  author TEXT NULL,
  author_url TEXT NULL,
  source_url TEXT NULL,
  attribution TEXT NOT NULL,
  color TEXT NULL,
  search_queries TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS image_metadata_provider_id_idx
  ON public.image_metadata(provider_id);
CREATE INDEX IF NOT EXISTS image_metadata_search_queries_gin_idx
  ON public.image_metadata USING gin(search_queries);
CREATE INDEX IF NOT EXISTS image_metadata_last_used_idx
  ON public.image_metadata(last_used_at);

CREATE TABLE IF NOT EXISTS public.image_search_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query_key TEXT NOT NULL,
  original_query TEXT NOT NULL,
  resolved_query TEXT NOT NULL,
  provider_ids TEXT[] NOT NULL,
  sources TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '1 day'
);

CREATE UNIQUE INDEX IF NOT EXISTS image_search_cache_query_key_idx
  ON public.image_search_cache(query_key);
CREATE INDEX IF NOT EXISTS image_search_cache_expires_idx
  ON public.image_search_cache(expires_at);

CREATE OR REPLACE FUNCTION public.image_metadata_append_query(
  p_provider_ids TEXT[],
  p_query TEXT
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.image_metadata
  SET search_queries = array_append(search_queries, p_query)
  WHERE provider_id = ANY(p_provider_ids)
    AND NOT (search_queries @> ARRAY[p_query]);
END;
$$;

CREATE TABLE IF NOT EXISTS public.intelligence_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  recommendation_id UUID NULL REFERENCES public.intelligence_recommendations(id) ON DELETE SET NULL,
  outcome_type TEXT NOT NULL,
  success_score NUMERIC NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.intelligence_outcomes
  DROP CONSTRAINT IF EXISTS intelligence_outcomes_company_rec_type_key;
ALTER TABLE public.intelligence_outcomes
  ADD CONSTRAINT intelligence_outcomes_company_rec_type_key
  UNIQUE (company_id, recommendation_id, outcome_type);

CREATE INDEX IF NOT EXISTS index_intelligence_outcomes_company
  ON public.intelligence_outcomes(company_id);
CREATE INDEX IF NOT EXISTS index_intelligence_outcomes_recommendation
  ON public.intelligence_outcomes(recommendation_id)
  WHERE recommendation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS index_intelligence_outcomes_company_created
  ON public.intelligence_outcomes(company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.platform_registry (
  platform_key TEXT PRIMARY KEY,
  platform_label TEXT NOT NULL,
  api_base_url TEXT NOT NULL,
  auth_type TEXT NOT NULL DEFAULT 'oauth',
  supports_publishing BOOLEAN NOT NULL DEFAULT true,
  supports_replies BOOLEAN NOT NULL DEFAULT true,
  supports_comments BOOLEAN NOT NULL DEFAULT true,
  supports_threads BOOLEAN NOT NULL DEFAULT false,
  supports_video BOOLEAN NOT NULL DEFAULT false,
  supports_ingestion BOOLEAN NOT NULL DEFAULT true,
  platform_category TEXT DEFAULT 'social',
  created_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO public.platform_registry (
  platform_key,
  platform_label,
  api_base_url,
  auth_type,
  supports_publishing,
  supports_replies,
  supports_comments,
  supports_threads,
  supports_video,
  supports_ingestion,
  platform_category
) VALUES
  ('linkedin', 'LinkedIn', 'https://api.linkedin.com/v2', 'oauth', true, true, true, false, true, true, 'social'),
  ('twitter', 'Twitter/X', 'https://api.twitter.com/2', 'oauth', true, true, true, true, true, true, 'social'),
  ('youtube', 'YouTube', 'https://www.googleapis.com/youtube/v3', 'oauth', true, true, true, false, true, true, 'social'),
  ('reddit', 'Reddit', 'https://oauth.reddit.com/api', 'oauth', true, true, true, true, false, true, 'social'),
  ('facebook', 'Facebook', 'https://graph.facebook.com/v22.0', 'oauth', true, true, true, false, true, true, 'social'),
  ('instagram', 'Instagram', 'https://graph.instagram.com', 'oauth', true, true, true, false, true, true, 'social'),
  ('tiktok', 'TikTok', 'https://open.tiktokapis.com/v2', 'oauth', true, true, true, false, true, true, 'social'),
  ('whatsapp', 'WhatsApp Business', 'https://graph.facebook.com/v22.0', 'oauth', true, true, false, true, false, true, 'social'),
  ('pinterest', 'Pinterest', 'https://api.pinterest.com/v5', 'oauth', true, false, true, false, false, true, 'social'),
  ('quora', 'Quora', 'https://api.quora.com', 'oauth', true, true, true, true, false, false, 'social'),
  ('slack', 'Slack Communities', 'https://slack.com/api', 'oauth', false, false, true, true, false, true, 'community'),
  ('discord', 'Discord', 'https://discord.com/api/v10', 'oauth', false, false, true, true, false, true, 'community'),
  ('github', 'GitHub Discussions', 'https://api.github.com', 'oauth', true, true, true, true, false, true, 'community'),
  ('stackoverflow', 'Stack Overflow', 'https://api.stackexchange.com/2.3', 'oauth', true, true, true, true, false, true, 'community'),
  ('producthunt', 'Product Hunt', 'https://api.producthunt.com/v2', 'oauth', true, false, true, false, false, true, 'community'),
  ('hackernews', 'Hacker News', 'https://hacker-news.firebaseio.com/v0', 'oauth', false, false, true, true, false, true, 'community')
ON CONFLICT (platform_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.recommendation_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  recommendation_id UUID NOT NULL REFERENCES public.intelligence_recommendations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  feedback_type TEXT NOT NULL,
  feedback_score NUMERIC NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS index_recommendation_feedback_company
  ON public.recommendation_feedback(company_id);
CREATE INDEX IF NOT EXISTS index_recommendation_feedback_recommendation
  ON public.recommendation_feedback(recommendation_id);
CREATE INDEX IF NOT EXISTS index_recommendation_feedback_user_created
  ON public.recommendation_feedback(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.response_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  pattern_structure JSONB NOT NULL,
  pattern_category TEXT NOT NULL,
  usage_count INTEGER NOT NULL DEFAULT 0,
  success_score NUMERIC NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_response_patterns_org_category
  ON public.response_patterns(organization_id, pattern_category);

CREATE TABLE IF NOT EXISTS public.response_policy_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  default_tone TEXT DEFAULT 'professional',
  emoji_usage TEXT DEFAULT 'minimal',
  response_style TEXT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(organization_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_response_policy_profiles_org_platform
  ON public.response_policy_profiles(organization_id, platform);

CREATE TABLE IF NOT EXISTS public.response_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  template_name TEXT NOT NULL,
  platform TEXT NULL,
  template_structure TEXT NOT NULL,
  tone TEXT DEFAULT 'professional',
  emoji_policy TEXT DEFAULT 'minimal',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_response_templates_org
  ON public.response_templates(organization_id);
CREATE INDEX IF NOT EXISTS idx_response_templates_platform
  ON public.response_templates(platform)
  WHERE platform IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.response_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  platform TEXT NULL,
  intent_type TEXT NOT NULL,
  template_id UUID NOT NULL REFERENCES public.response_templates(id) ON DELETE CASCADE,
  auto_reply BOOLEAN DEFAULT false,
  priority INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_response_rules_org_platform_intent
  ON public.response_rules(organization_id, platform, intent_type);
CREATE INDEX IF NOT EXISTS idx_response_rules_priority
  ON public.response_rules(priority DESC);

CREATE TABLE IF NOT EXISTS public.response_strategy_intelligence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  classification_category TEXT NOT NULL,
  sentiment TEXT NOT NULL DEFAULT 'neutral',
  strategy_type TEXT NOT NULL,
  total_uses INTEGER NOT NULL DEFAULT 0,
  successful_interactions INTEGER NOT NULL DEFAULT 0,
  engagement_score NUMERIC NOT NULL DEFAULT 0,
  confidence_score NUMERIC NOT NULL DEFAULT 0,
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_strategy_org_category
  ON public.response_strategy_intelligence(organization_id, classification_category);
CREATE INDEX IF NOT EXISTS idx_strategy_engagement
  ON public.response_strategy_intelligence(engagement_score DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_strategy_org_cat_sent_type
  ON public.response_strategy_intelligence(organization_id, classification_category, sentiment, strategy_type);

CREATE TABLE IF NOT EXISTS public.weekly_content_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  week_number INTEGER NOT NULL CHECK (week_number >= 1 AND week_number <= 12),
  phase VARCHAR(100) NULL,
  theme VARCHAR(255) NOT NULL,
  focus_area TEXT NOT NULL,
  key_messaging TEXT NULL,
  content_types TEXT[] NOT NULL,
  platform_strategy JSONB NOT NULL,
  call_to_action TEXT NULL,
  target_metrics JSONB NOT NULL,
  key_performance_indicators JSONB NULL,
  content_guidelines TEXT NULL,
  hashtag_suggestions TEXT[] NULL,
  visual_requirements JSONB NULL,
  status VARCHAR(50) DEFAULT 'planned',
  completion_percentage INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(campaign_id, week_number)
);

CREATE INDEX IF NOT EXISTS idx_weekly_plans_campaign_week
  ON public.weekly_content_plans(campaign_id, week_number);

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'audit_logs',
    'campaign_distribution_decisions',
    'campaign_plan_jobs',
    'campaign_preemption_requests',
    'campaign_readiness_leads',
    'engagement_thread_classification',
    'image_metadata',
    'image_search_cache',
    'intelligence_outcomes',
    'platform_registry',
    'recommendation_feedback',
    'response_patterns',
    'response_policy_profiles',
    'response_rules',
    'response_strategy_intelligence',
    'response_templates',
    'weekly_content_plans'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = t
        AND policyname = 'service_role_full_access'
    ) THEN
      EXECUTE format(
        'CREATE POLICY "service_role_full_access" ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
        t
      );
    END IF;
  END LOOP;
END $$;

COMMIT;

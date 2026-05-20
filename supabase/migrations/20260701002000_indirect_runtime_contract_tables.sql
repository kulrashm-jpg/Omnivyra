-- Promotes indirectly referenced runtime contracts from database/*.sql into
-- the authoritative Supabase migration stream.

BEGIN;

CREATE TABLE IF NOT EXISTS public.campaign_context (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL UNIQUE,
  company_id UUID NOT NULL,
  account_context JSONB NULL,
  validation JSONB NULL,
  paid_recommendation JSONB NULL,
  context_created_at TIMESTAMPTZ NULL,
  performance_insights JSONB NULL,
  memory_updated_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_context_company
  ON public.campaign_context(company_id, context_created_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaign_context_campaign
  ON public.campaign_context(campaign_id);

CREATE OR REPLACE FUNCTION public.update_campaign_context_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_campaign_context_updated_at ON public.campaign_context;
CREATE TRIGGER trg_campaign_context_updated_at
  BEFORE UPDATE ON public.campaign_context
  FOR EACH ROW EXECUTE FUNCTION public.update_campaign_context_updated_at();

CREATE TABLE IF NOT EXISTS public.campaign_execution_checkpoint (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  week SMALLINT NOT NULL CHECK (week >= 1 AND week <= 12),
  day SMALLINT NOT NULL CHECK (day >= 1 AND day <= 7),
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'abandoned')),
  content_id UUID NULL,
  content_source TEXT DEFAULT 'content_assets',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(campaign_id, week, day)
);

CREATE INDEX IF NOT EXISTS idx_campaign_execution_checkpoint_campaign
  ON public.campaign_execution_checkpoint(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_execution_checkpoint_status
  ON public.campaign_execution_checkpoint(campaign_id, status);

CREATE TABLE IF NOT EXISTS public.company_execution_priority (
  company_id UUID PRIMARY KEY,
  priority_level TEXT NOT NULL DEFAULT 'NORMAL',
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS index_company_execution_priority_level
  ON public.company_execution_priority(priority_level);

CREATE TABLE IF NOT EXISTS public.engagement_telemetry_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  thread_id TEXT NULL,
  user_id TEXT NULL,
  event_name TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_engagement_telemetry_org_created
  ON public.engagement_telemetry_events(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_engagement_telemetry_event
  ON public.engagement_telemetry_events(event_name, created_at DESC);

CREATE TABLE IF NOT EXISTS public.governance_lockdown (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  locked BOOLEAN NOT NULL DEFAULT false,
  reason TEXT NULL,
  triggered_at TIMESTAMPTZ NULL,
  triggered_by UUID NULL,
  resolved_at TIMESTAMPTZ NULL,
  resolved_by UUID NULL
);

CREATE TABLE IF NOT EXISTS public.intelligence_execution_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  execution_type TEXT NOT NULL,
  status TEXT NOT NULL,
  latency_ms NUMERIC NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS index_intelligence_execution_logs_company
  ON public.intelligence_execution_logs(company_id);
CREATE INDEX IF NOT EXISTS index_intelligence_execution_logs_type
  ON public.intelligence_execution_logs(execution_type);
CREATE INDEX IF NOT EXISTS index_intelligence_execution_logs_created
  ON public.intelligence_execution_logs(company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.intelligence_execution_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  execution_type TEXT NOT NULL,
  executed_at TIMESTAMPTZ DEFAULT now(),
  execution_date DATE GENERATED ALWAYS AS ((executed_at AT TIME ZONE 'UTC')::date) STORED
);

CREATE INDEX IF NOT EXISTS index_intelligence_execution_metrics_company
  ON public.intelligence_execution_metrics(company_id);
CREATE INDEX IF NOT EXISTS index_intelligence_execution_metrics_company_type
  ON public.intelligence_execution_metrics(company_id, execution_type);
CREATE INDEX IF NOT EXISTS index_intelligence_execution_metrics_company_date
  ON public.intelligence_execution_metrics(company_id, execution_date);
CREATE INDEX IF NOT EXISTS index_intelligence_execution_metrics_executed
  ON public.intelligence_execution_metrics(company_id, execution_type, executed_at DESC);

CREATE TABLE IF NOT EXISTS public.message_reads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL,
  message_source TEXT NOT NULL CHECK (message_source IN ('activity', 'calendar', 'campaign')),
  user_id UUID NOT NULL,
  read_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(message_id, message_source, user_id)
);

CREATE INDEX IF NOT EXISTS idx_message_reads_user_source
  ON public.message_reads(user_id, message_source);
CREATE INDEX IF NOT EXISTS idx_message_reads_message
  ON public.message_reads(message_id, message_source);

CREATE TABLE IF NOT EXISTS public.message_mentions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL,
  message_source TEXT NOT NULL CHECK (message_source IN ('activity', 'calendar', 'campaign')),
  mentioned_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(message_id, message_source, mentioned_user_id)
);

CREATE INDEX IF NOT EXISTS idx_message_mentions_mentioned
  ON public.message_mentions(mentioned_user_id);
CREATE INDEX IF NOT EXISTS idx_message_mentions_message
  ON public.message_mentions(message_id, message_source);

CREATE TABLE IF NOT EXISTS public.platform_connectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  platform_key TEXT NOT NULL REFERENCES public.platform_registry(platform_key) ON DELETE RESTRICT,
  account_id TEXT NULL,
  access_token TEXT NULL,
  refresh_token TEXT NULL,
  expires_at TIMESTAMPTZ NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(organization_id, platform_key)
);

CREATE INDEX IF NOT EXISTS idx_platform_connectors_organization_id
  ON public.platform_connectors(organization_id);
CREATE INDEX IF NOT EXISTS idx_platform_connectors_platform_key
  ON public.platform_connectors(platform_key);
CREATE INDEX IF NOT EXISTS idx_platform_connectors_active
  ON public.platform_connectors(organization_id, platform_key)
  WHERE active = true;

CREATE TABLE IF NOT EXISTS public.scheduling_intelligence_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  signal_type TEXT NOT NULL,
  signal_source TEXT NOT NULL,
  signal_topic TEXT NOT NULL,
  signal_score NUMERIC NOT NULL DEFAULT 0,
  signal_timestamp TIMESTAMPTZ NOT NULL,
  metadata JSONB NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scheduling_signals_company_time
  ON public.scheduling_intelligence_signals(company_id, signal_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_scheduling_signals_company_score
  ON public.scheduling_intelligence_signals(company_id, signal_score DESC);
CREATE INDEX IF NOT EXISTS idx_scheduling_signals_type
  ON public.scheduling_intelligence_signals(signal_type)
  WHERE signal_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_scheduling_signals_week_range
  ON public.scheduling_intelligence_signals(company_id, signal_timestamp)
  WHERE signal_timestamp IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.strategy_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  company_id UUID NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  objective TEXT NOT NULL,
  campaign_intent TEXT NULL,
  target_audience TEXT NOT NULL,
  key_platforms TEXT[] NOT NULL,
  content_pillars JSONB NULL,
  content_frequency JSONB NULL,
  distribution_preferences JSONB NULL,
  tags TEXT[] NULL,
  is_public BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_strategy_templates_user
  ON public.strategy_templates(user_id);
CREATE INDEX IF NOT EXISTS idx_strategy_templates_company
  ON public.strategy_templates(company_id);

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'campaign_context',
    'campaign_execution_checkpoint',
    'company_execution_priority',
    'engagement_telemetry_events',
    'governance_lockdown',
    'intelligence_execution_logs',
    'intelligence_execution_metrics',
    'message_mentions',
    'message_reads',
    'platform_connectors',
    'scheduling_intelligence_signals',
    'strategy_templates'
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

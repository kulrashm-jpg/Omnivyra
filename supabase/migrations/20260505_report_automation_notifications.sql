BEGIN;

CREATE TABLE IF NOT EXISTS public.report_automation_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  frequency TEXT NOT NULL DEFAULT 'weekly'
    CHECK (frequency IN ('weekly', 'biweekly', 'monthly')),
  change_detection_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  last_checked_at TIMESTAMPTZ,
  last_triggered_report_id UUID REFERENCES public.reports(id) ON DELETE SET NULL,
  last_change_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT report_automation_configs_user_company_domain_unique
    UNIQUE (user_id, company_id, domain)
);

CREATE INDEX IF NOT EXISTS idx_report_automation_configs_company_active
  ON public.report_automation_configs(company_id, is_active, next_run_at ASC);

CREATE INDEX IF NOT EXISTS idx_report_automation_configs_user_active
  ON public.report_automation_configs(user_id, is_active, created_at DESC);

CREATE TABLE IF NOT EXISTS public.report_automation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_config_id UUID REFERENCES public.report_automation_configs(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('scheduled', 'content_change', 'traffic_change')),
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  report_id UUID REFERENCES public.reports(id) ON DELETE SET NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_report_automation_events_company_triggered
  ON public.report_automation_events(company_id, triggered_at DESC);

CREATE INDEX IF NOT EXISTS idx_report_automation_events_user_triggered
  ON public.report_automation_events(user_id, triggered_at DESC);

CREATE TABLE IF NOT EXISTS public.report_notification_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('improvement', 'decline', 'opportunity')),
  message TEXT NOT NULL,
  linked_report_id UUID REFERENCES public.reports(id) ON DELETE SET NULL,
  event_fingerprint TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT report_notification_events_fingerprint_unique UNIQUE (event_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_report_notification_events_user_created
  ON public.report_notification_events(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_report_notification_events_company_created
  ON public.report_notification_events(company_id, created_at DESC);

COMMIT;

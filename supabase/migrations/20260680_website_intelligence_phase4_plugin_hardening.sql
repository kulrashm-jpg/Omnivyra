-- Omnivera Website Intelligence - Phase 4 Plugin Hardening Recovery
-- Adds productization analytics, health scoring, signals, dashboard cache,
-- and form intelligence tables consumed by Website Intelligence services.

BEGIN;

CREATE TABLE IF NOT EXISTS public.form_performance_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  website_id UUID NULL REFERENCES public.websites(id) ON DELETE SET NULL,
  form_id UUID NULL REFERENCES public.forms(id) ON DELETE SET NULL,
  day DATE NOT NULL,
  impressions INTEGER NOT NULL DEFAULT 0,
  starts INTEGER NOT NULL DEFAULT 0,
  submissions INTEGER NOT NULL DEFAULT 0,
  abandonments INTEGER NOT NULL DEFAULT 0,
  cta_to_submit_count INTEGER NOT NULL DEFAULT 0,
  completion_rate NUMERIC(8,4) NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_form_performance_daily_company_website_form_day
  ON public.form_performance_daily(company_id, website_id, form_id, day);
CREATE INDEX IF NOT EXISTS idx_form_performance_daily_company_day
  ON public.form_performance_daily(company_id, day DESC);

CREATE TABLE IF NOT EXISTS public.form_field_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  website_id UUID NULL REFERENCES public.websites(id) ON DELETE SET NULL,
  form_id UUID NULL REFERENCES public.forms(id) ON DELETE SET NULL,
  field_key TEXT NOT NULL,
  day DATE NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  starts INTEGER NOT NULL DEFAULT 0,
  completions INTEGER NOT NULL DEFAULT 0,
  dropoffs INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_form_field_analytics_company_website_form_field_day
  ON public.form_field_analytics(company_id, website_id, form_id, field_key, day);
CREATE INDEX IF NOT EXISTS idx_form_field_analytics_company_day
  ON public.form_field_analytics(company_id, day DESC);

CREATE TABLE IF NOT EXISTS public.website_health_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  website_id UUID NOT NULL REFERENCES public.websites(id) ON DELETE CASCADE,
  composite_score INTEGER NOT NULL DEFAULT 0,
  category_scores JSONB NOT NULL DEFAULT '{}'::jsonb,
  issues JSONB NOT NULL DEFAULT '[]'::jsonb,
  recommendations JSONB NOT NULL DEFAULT '[]'::jsonb,
  improvement_priorities JSONB NOT NULL DEFAULT '[]'::jsonb,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT website_health_scores_composite_check CHECK (composite_score >= 0 AND composite_score <= 100)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_website_health_scores_website
  ON public.website_health_scores(website_id);
CREATE INDEX IF NOT EXISTS idx_website_health_scores_company_computed
  ON public.website_health_scores(company_id, computed_at DESC);

CREATE TABLE IF NOT EXISTS public.website_intelligence_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  website_id UUID NOT NULL REFERENCES public.websites(id) ON DELETE CASCADE,
  signal_key TEXT NOT NULL,
  type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  confidence NUMERIC(6,4) NOT NULL DEFAULT 0,
  recommendation TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolved_state TEXT NOT NULL DEFAULT 'active',
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT website_intelligence_signals_severity_check CHECK (severity IN ('info','low','medium','high','critical')),
  CONSTRAINT website_intelligence_signals_resolved_state_check CHECK (resolved_state IN ('active','acknowledged','resolved','ignored'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_website_intelligence_signals_key
  ON public.website_intelligence_signals(company_id, website_id, signal_key);
CREATE INDEX IF NOT EXISTS idx_website_intelligence_signals_company_generated
  ON public.website_intelligence_signals(company_id, generated_at DESC);

CREATE TABLE IF NOT EXISTS public.website_dashboard_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  website_id UUID NULL REFERENCES public.websites(id) ON DELETE CASCADE,
  cache_key TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_website_dashboard_cache_company_website_key
  ON public.website_dashboard_cache(company_id, website_id, cache_key);
CREATE INDEX IF NOT EXISTS idx_website_dashboard_cache_expiry
  ON public.website_dashboard_cache(expires_at);

CREATE TABLE IF NOT EXISTS public.attribution_summary_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  website_id UUID NULL REFERENCES public.websites(id) ON DELETE CASCADE,
  cache_key TEXT NOT NULL,
  from_day DATE NOT NULL,
  to_day DATE NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_attribution_summary_cache_key
  ON public.attribution_summary_cache(company_id, website_id, cache_key);

DO $$
DECLARE
  t TEXT;
  protected_tables TEXT[] := ARRAY[
    'form_performance_daily',
    'form_field_analytics',
    'website_health_scores',
    'website_intelligence_signals',
    'website_dashboard_cache',
    'attribution_summary_cache'
  ];
BEGIN
  FOREACH t IN ARRAY protected_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = t
        AND policyname = 'service_role_full_access'
    ) THEN
      EXECUTE format('DROP POLICY "service_role_full_access" ON public.%I', t);
    END IF;
    EXECUTE format(
      'CREATE POLICY "service_role_full_access" ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      t
    );
  END LOOP;
END $$;

COMMIT;

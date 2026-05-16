ALTER TABLE public.analytics_serp_snapshots
  DROP CONSTRAINT IF EXISTS analytics_serp_snapshots_provider_valid;

ALTER TABLE public.analytics_serp_snapshots
  ADD CONSTRAINT analytics_serp_snapshots_provider_valid
    CHECK (provider IN ('manual_import', 'compliant_api', 'dataforseo', 'serpapi', 'scaleserp', 'synthetic_validation'));

ALTER TABLE public.analytics_serp_acquisition_runs
  DROP CONSTRAINT IF EXISTS analytics_serp_acquisition_runs_provider_valid;

ALTER TABLE public.analytics_serp_acquisition_runs
  ADD CONSTRAINT analytics_serp_acquisition_runs_provider_valid
    CHECK (provider IN ('manual_import', 'compliant_api', 'dataforseo', 'serpapi', 'scaleserp'));

ALTER TABLE public.analytics_serp_acquisition_runs
  ADD COLUMN IF NOT EXISTS competitors_observed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estimated_cost_usd numeric NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.analytics_serp_provider_health (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  status text NOT NULL DEFAULT 'unknown',
  checked_at timestamptz NOT NULL DEFAULT now(),
  requests integer NOT NULL DEFAULT 0,
  successes integer NOT NULL DEFAULT 0,
  failures integer NOT NULL DEFAULT 0,
  quota_remaining integer,
  estimated_cost_usd numeric NOT NULL DEFAULT 0,
  last_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT analytics_serp_provider_health_provider_valid
    CHECK (provider IN ('manual_import', 'compliant_api', 'dataforseo', 'serpapi', 'scaleserp')),
  CONSTRAINT analytics_serp_provider_health_status_valid
    CHECK (status IN ('ready', 'not_configured', 'degraded', 'failed', 'unknown'))
);

CREATE INDEX IF NOT EXISTS idx_analytics_serp_provider_health_checked
  ON public.analytics_serp_provider_health(provider, checked_at DESC);

COMMENT ON TABLE public.analytics_serp_provider_health IS
  'SERP provider health, quota, and cost telemetry. Does not store provider credentials.';

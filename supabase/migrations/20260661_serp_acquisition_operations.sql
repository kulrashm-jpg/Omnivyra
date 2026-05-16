CREATE TABLE IF NOT EXISTS public.analytics_serp_query_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  query text NOT NULL,
  source text NOT NULL DEFAULT 'gsc_high_value',
  priority_score numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'queued',
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  next_refresh_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT analytics_serp_query_queue_source_valid
    CHECK (source IN ('gsc_high_value', 'authority_topic', 'commercial_intent', 'manual')),
  CONSTRAINT analytics_serp_query_queue_status_valid
    CHECK (status IN ('queued', 'running', 'completed', 'failed', 'paused')),
  CONSTRAINT analytics_serp_query_queue_unique
    UNIQUE (company_id, query)
);

CREATE INDEX IF NOT EXISTS idx_analytics_serp_query_queue_due
  ON public.analytics_serp_query_queue(company_id, status, next_refresh_at, priority_score DESC);

DROP TRIGGER IF EXISTS trg_analytics_serp_query_queue_updated_at
  ON public.analytics_serp_query_queue;

CREATE TRIGGER trg_analytics_serp_query_queue_updated_at
  BEFORE UPDATE ON public.analytics_serp_query_queue
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.analytics_serp_acquisition_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  provider text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  attempted_queries integer NOT NULL DEFAULT 0,
  snapshots_written integer NOT NULL DEFAULT 0,
  results_written integer NOT NULL DEFAULT 0,
  competitors_observed integer NOT NULL DEFAULT 0,
  estimated_cost_usd numeric NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT analytics_serp_acquisition_runs_provider_valid
    CHECK (provider IN ('manual_import', 'compliant_api', 'dataforseo', 'serpapi', 'scaleserp')),
  CONSTRAINT analytics_serp_acquisition_runs_status_valid
    CHECK (status IN ('running', 'completed', 'partial', 'skipped', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_analytics_serp_acquisition_runs_company
  ON public.analytics_serp_acquisition_runs(company_id, started_at DESC, status);

COMMENT ON TABLE public.analytics_serp_query_queue IS
  'Prioritized SERP acquisition queue seeded from canonical GSC and authority-topic evidence. No fabricated SERP data.';

COMMENT ON TABLE public.analytics_serp_acquisition_runs IS
  'Operational SERP acquisition history for compliant API/manual providers with bounded query execution metadata.';

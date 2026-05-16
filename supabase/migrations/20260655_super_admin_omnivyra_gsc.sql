CREATE TABLE IF NOT EXISTS public.platform_gsc_sync_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL DEFAULT 'omnivyra_website',
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  property_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_synced',
  degraded_state TEXT NOT NULL DEFAULT 'no_analytics',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_successful_sync_at TIMESTAMPTZ,
  last_successful_data_date DATE,
  rows_fetched INTEGER NOT NULL DEFAULT 0,
  rows_ingested INTEGER NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT platform_gsc_sync_status_scope_property_unique
    UNIQUE (scope, property_url),
  CONSTRAINT platform_gsc_sync_status_status_valid
    CHECK (status IN ('not_synced', 'syncing', 'completed', 'partial', 'failed')),
  CONSTRAINT platform_gsc_sync_status_degraded_valid
    CHECK (degraded_state IN ('live', 'stale', 'partial', 'failed', 'no_analytics'))
);

CREATE INDEX IF NOT EXISTS idx_platform_gsc_sync_status_scope
  ON public.platform_gsc_sync_status(scope, status, last_successful_sync_at DESC);

DROP TRIGGER IF EXISTS trg_platform_gsc_sync_status_updated_at ON public.platform_gsc_sync_status;
CREATE TRIGGER trg_platform_gsc_sync_status_updated_at
  BEFORE UPDATE ON public.platform_gsc_sync_status
  FOR EACH ROW
  EXECUTE FUNCTION public.omnivyra_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.platform_gsc_daily_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL DEFAULT 'omnivyra_website',
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  property_url TEXT NOT NULL,
  metric_date DATE NOT NULL,
  clicks BIGINT NOT NULL DEFAULT 0,
  impressions BIGINT NOT NULL DEFAULT 0,
  ctr NUMERIC(10,6) NOT NULL DEFAULT 0,
  avg_position NUMERIC(10,4) NOT NULL DEFAULT 0,
  raw_rows INTEGER NOT NULL DEFAULT 0,
  ingestion_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT platform_gsc_daily_metrics_unique
    UNIQUE (scope, property_url, metric_date),
  CONSTRAINT platform_gsc_daily_metrics_non_negative
    CHECK (clicks >= 0 AND impressions >= 0 AND ctr >= 0)
);

CREATE INDEX IF NOT EXISTS idx_platform_gsc_daily_metrics_scope_date
  ON public.platform_gsc_daily_metrics(scope, property_url, metric_date DESC);

DROP TRIGGER IF EXISTS trg_platform_gsc_daily_metrics_updated_at ON public.platform_gsc_daily_metrics;
CREATE TRIGGER trg_platform_gsc_daily_metrics_updated_at
  BEFORE UPDATE ON public.platform_gsc_daily_metrics
  FOR EACH ROW
  EXECUTE FUNCTION public.omnivyra_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.platform_gsc_query_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL DEFAULT 'omnivyra_website',
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  property_url TEXT NOT NULL,
  metric_date DATE NOT NULL,
  query TEXT NOT NULL DEFAULT '',
  page_url TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  device TEXT NOT NULL DEFAULT '',
  clicks BIGINT NOT NULL DEFAULT 0,
  impressions BIGINT NOT NULL DEFAULT 0,
  ctr NUMERIC(10,6) NOT NULL DEFAULT 0,
  avg_position NUMERIC(10,4) NOT NULL DEFAULT 0,
  ingestion_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT platform_gsc_query_metrics_unique
    UNIQUE (scope, property_url, metric_date, query, page_url, country, device),
  CONSTRAINT platform_gsc_query_metrics_non_negative
    CHECK (clicks >= 0 AND impressions >= 0 AND ctr >= 0)
);

CREATE INDEX IF NOT EXISTS idx_platform_gsc_query_metrics_scope_date
  ON public.platform_gsc_query_metrics(scope, property_url, metric_date DESC);

CREATE INDEX IF NOT EXISTS idx_platform_gsc_query_metrics_query
  ON public.platform_gsc_query_metrics(scope, property_url, query, impressions DESC);

CREATE INDEX IF NOT EXISTS idx_platform_gsc_query_metrics_page
  ON public.platform_gsc_query_metrics(scope, property_url, page_url, impressions DESC);

DROP TRIGGER IF EXISTS trg_platform_gsc_query_metrics_updated_at ON public.platform_gsc_query_metrics;
CREATE TRIGGER trg_platform_gsc_query_metrics_updated_at
  BEFORE UPDATE ON public.platform_gsc_query_metrics
  FOR EACH ROW
  EXECUTE FUNCTION public.omnivyra_touch_updated_at();


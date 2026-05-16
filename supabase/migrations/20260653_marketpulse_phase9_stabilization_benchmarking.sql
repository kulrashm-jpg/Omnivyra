BEGIN;

-- MarketPulse Phase 9: stabilization, event dedupe, benchmarking readiness,
-- and operational observability. No forecasting or autonomous strategy.

ALTER TABLE marketpulse_historical_timeline_events
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT,
  ADD COLUMN IF NOT EXISTS event_priority INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS material_change_score NUMERIC(6,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS coalesced_count INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_coalesced_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_marketpulse_timeline_dedupe
  ON marketpulse_historical_timeline_events(company_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_marketpulse_timeline_priority
  ON marketpulse_historical_timeline_events(company_id, event_priority DESC, occurred_at DESC);

ALTER TABLE marketpulse_comparative_intelligence
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT,
  ADD COLUMN IF NOT EXISTS material_change_score NUMERIC(6,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS coalesced_count INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_coalesced_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_marketpulse_comparative_dedupe
  ON marketpulse_comparative_intelligence(company_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS marketpulse_benchmark_dimensions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  dimension_type TEXT NOT NULL,
  dimension_key TEXT NOT NULL,
  dimension_label TEXT NOT NULL,
  readiness_status TEXT NOT NULL DEFAULT 'ready_for_mapping',
  source TEXT NOT NULL DEFAULT 'marketpulse_foundation',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT marketpulse_benchmark_dimensions_type_valid
    CHECK (dimension_type IN ('peer_group', 'industry', 'sector', 'geography', 'company_stage', 'company_size')),
  CONSTRAINT marketpulse_benchmark_dimensions_status_valid
    CHECK (readiness_status IN ('ready_for_mapping', 'needs_confirmation', 'inactive')),
  CONSTRAINT marketpulse_benchmark_dimensions_metadata_object
    CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT marketpulse_benchmark_dimensions_unique
    UNIQUE(company_id, dimension_type, dimension_key)
);

CREATE INDEX IF NOT EXISTS idx_marketpulse_benchmark_dimensions_company
  ON marketpulse_benchmark_dimensions(company_id, dimension_type, readiness_status);

CREATE TABLE IF NOT EXISTS marketpulse_benchmark_baseline_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  baseline_type TEXT NOT NULL,
  baseline_key TEXT NOT NULL,
  baseline_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  readiness_status TEXT NOT NULL DEFAULT 'schema_ready',
  generated_from TEXT NOT NULL DEFAULT 'internal_marketpulse_context',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT marketpulse_benchmark_baseline_type_valid
    CHECK (baseline_type IN ('peer_relative', 'industry_relative', 'sector_relative', 'historical_self')),
  CONSTRAINT marketpulse_benchmark_baseline_status_valid
    CHECK (readiness_status IN ('schema_ready', 'insufficient_data', 'ready_for_future_benchmarking')),
  CONSTRAINT marketpulse_benchmark_baseline_payload_object
    CHECK (jsonb_typeof(baseline_payload) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_marketpulse_benchmark_baselines_company
  ON marketpulse_benchmark_baseline_snapshots(company_id, baseline_type, created_at DESC);

CREATE TABLE IF NOT EXISTS marketpulse_operational_observability_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  operation_name TEXT NOT NULL,
  operation_status TEXT NOT NULL DEFAULT 'ok',
  duration_ms INTEGER,
  payload_size_bytes INTEGER,
  row_count INTEGER,
  cache_status TEXT NOT NULL DEFAULT 'not_applicable',
  fallback_used BOOLEAN NOT NULL DEFAULT false,
  error_summary TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT marketpulse_observability_status_valid
    CHECK (operation_status IN ('ok', 'warning', 'error', 'degraded')),
  CONSTRAINT marketpulse_observability_cache_valid
    CHECK (cache_status IN ('hit', 'miss', 'stale', 'not_applicable')),
  CONSTRAINT marketpulse_observability_metadata_object
    CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_marketpulse_observability_company
  ON marketpulse_operational_observability_events(company_id, operation_name, created_at DESC);

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'marketpulse_benchmark_dimensions',
    'marketpulse_benchmark_baseline_snapshots',
    'marketpulse_operational_observability_events'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = t
        AND policyname = 'service_role_full_access'
    ) THEN
      EXECUTE format('DROP POLICY "service_role_full_access" ON public.%I', t);
    END IF;
    EXECUTE format(
      'CREATE POLICY "service_role_full_access" ON public.%I FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')',
      t
    );
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS trg_marketpulse_benchmark_dimensions_updated_at ON marketpulse_benchmark_dimensions;
CREATE TRIGGER trg_marketpulse_benchmark_dimensions_updated_at
BEFORE UPDATE ON marketpulse_benchmark_dimensions
FOR EACH ROW EXECUTE FUNCTION omnivyra_touch_updated_at();

COMMIT;

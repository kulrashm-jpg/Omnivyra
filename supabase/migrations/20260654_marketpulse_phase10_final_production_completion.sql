BEGIN;

-- MarketPulse Phase 10: final production completion, resilience,
-- observability completion, benchmark readiness, and integrity safeguards.
-- No predictive forecasting, autonomous strategy, or automated remediation.

ALTER TABLE marketpulse_historical_timeline_events
  ADD COLUMN IF NOT EXISTS dedupe_window_key TEXT,
  ADD COLUMN IF NOT EXISTS duplicate_suppression_window_minutes INTEGER NOT NULL DEFAULT 360,
  ADD COLUMN IF NOT EXISTS severity_change_threshold NUMERIC(6,2) NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS lifecycle_transition_key TEXT;

CREATE INDEX IF NOT EXISTS idx_marketpulse_timeline_window
  ON marketpulse_historical_timeline_events(company_id, dedupe_window_key, occurred_at DESC)
  WHERE dedupe_window_key IS NOT NULL;

ALTER TABLE marketpulse_escalation_events
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT,
  ADD COLUMN IF NOT EXISTS coalesced_count INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_coalesced_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_marketpulse_escalation_events_dedupe
  ON marketpulse_escalation_events(company_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

ALTER TABLE marketpulse_lifecycle_states
  ADD COLUMN IF NOT EXISTS transition_key TEXT,
  ADD COLUMN IF NOT EXISTS transition_count INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_material_transition_at TIMESTAMPTZ;

ALTER TABLE marketpulse_operational_validation_events
  DROP CONSTRAINT IF EXISTS marketpulse_validation_type_valid;

ALTER TABLE marketpulse_operational_validation_events
  ADD CONSTRAINT marketpulse_validation_type_valid
  CHECK (validation_type IN (
    'orphan_investigation',
    'stale_escalation',
    'lifecycle_inconsistency',
    'invalid_escalation',
    'low_confidence_noise',
    'oversized_payload',
    'visibility_risk',
    'broken_action_link',
    'invalid_decision_reference',
    'annotation_visibility_conflict',
    'routing_inconsistency',
    'timeline_spam',
    'escalation_storm',
    'low_sample_benchmark',
    'weak_cohort_confidence',
    'rendering_regression',
    'synthesis_degradation'
  ));

CREATE TABLE IF NOT EXISTS marketpulse_benchmark_cohorts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  cohort_type TEXT NOT NULL,
  cohort_key TEXT NOT NULL,
  cohort_label TEXT NOT NULL,
  sample_size INTEGER NOT NULL DEFAULT 0,
  confidence NUMERIC(5,2) NOT NULL DEFAULT 0,
  readiness_status TEXT NOT NULL DEFAULT 'needs_confirmation',
  governance_flags JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT marketpulse_benchmark_cohorts_type_valid
    CHECK (cohort_type IN ('peer_group', 'industry', 'sector', 'geography', 'company_stage', 'company_size')),
  CONSTRAINT marketpulse_benchmark_cohorts_status_valid
    CHECK (readiness_status IN ('schema_ready', 'needs_confirmation', 'insufficient_sample', 'ready_for_future_benchmarking')),
  CONSTRAINT marketpulse_benchmark_cohorts_scores_valid
    CHECK (sample_size >= 0 AND confidence BETWEEN 0 AND 100),
  CONSTRAINT marketpulse_benchmark_cohorts_flags_object
    CHECK (jsonb_typeof(governance_flags) = 'object'),
  CONSTRAINT marketpulse_benchmark_cohorts_metadata_object
    CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT marketpulse_benchmark_cohorts_unique
    UNIQUE(company_id, cohort_type, cohort_key)
);

CREATE INDEX IF NOT EXISTS idx_marketpulse_benchmark_cohorts_company
  ON marketpulse_benchmark_cohorts(company_id, cohort_type, readiness_status);

CREATE TABLE IF NOT EXISTS marketpulse_benchmark_relative_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  benchmark_dimension_id UUID REFERENCES marketpulse_benchmark_dimensions(id) ON DELETE CASCADE,
  cohort_id UUID REFERENCES marketpulse_benchmark_cohorts(id) ON DELETE CASCADE,
  normalized_pressure_area TEXT NOT NULL,
  relative_severity_scale JSONB NOT NULL DEFAULT '{}'::jsonb,
  baseline_metric_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence NUMERIC(5,2) NOT NULL DEFAULT 0,
  governance_flags JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT marketpulse_benchmark_mappings_severity_object
    CHECK (jsonb_typeof(relative_severity_scale) = 'object'),
  CONSTRAINT marketpulse_benchmark_mappings_baseline_object
    CHECK (jsonb_typeof(baseline_metric_payload) = 'object'),
  CONSTRAINT marketpulse_benchmark_mappings_flags_object
    CHECK (jsonb_typeof(governance_flags) = 'object'),
  CONSTRAINT marketpulse_benchmark_mappings_confidence_valid
    CHECK (confidence BETWEEN 0 AND 100)
);

CREATE INDEX IF NOT EXISTS idx_marketpulse_benchmark_mappings_company
  ON marketpulse_benchmark_relative_mappings(company_id, normalized_pressure_area, created_at DESC);

CREATE TABLE IF NOT EXISTS marketpulse_operational_health_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  health_status TEXT NOT NULL DEFAULT 'ok',
  summary TEXT NOT NULL,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  repair_readiness JSONB NOT NULL DEFAULT '{}'::jsonb,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT marketpulse_health_status_valid
    CHECK (health_status IN ('ok', 'watch', 'degraded', 'critical')),
  CONSTRAINT marketpulse_health_metrics_object
    CHECK (jsonb_typeof(metrics) = 'object'),
  CONSTRAINT marketpulse_health_warnings_array
    CHECK (jsonb_typeof(warnings) = 'array'),
  CONSTRAINT marketpulse_health_repair_object
    CHECK (jsonb_typeof(repair_readiness) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_marketpulse_health_company
  ON marketpulse_operational_health_summaries(company_id, generated_at DESC);

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'marketpulse_benchmark_cohorts',
    'marketpulse_benchmark_relative_mappings',
    'marketpulse_operational_health_summaries'
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

DROP TRIGGER IF EXISTS trg_marketpulse_benchmark_cohorts_updated_at ON marketpulse_benchmark_cohorts;
CREATE TRIGGER trg_marketpulse_benchmark_cohorts_updated_at
BEFORE UPDATE ON marketpulse_benchmark_cohorts
FOR EACH ROW EXECUTE FUNCTION omnivyra_touch_updated_at();

COMMIT;

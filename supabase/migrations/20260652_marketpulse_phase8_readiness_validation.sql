BEGIN;

-- MarketPulse Phase 8: production readiness, operational validation,
-- historical timeline support, and safer comparative/opportunity quality
-- metadata. This remains non-predictive and non-autonomous.

ALTER TABLE marketpulse_opportunity_intelligence
  DROP CONSTRAINT IF EXISTS marketpulse_opportunity_type_valid;

ALTER TABLE marketpulse_opportunity_intelligence
  ADD CONSTRAINT marketpulse_opportunity_type_valid
  CHECK (opportunity_type IN (
    'market_opening',
    'competitive_gap',
    'cost_relief',
    'regulatory_clarity',
    'talent_window',
    'technology_advantage',
    'funding_tailwind',
    'customer_demand',
    'market_expansion',
    'technology_leverage',
    'workforce_availability',
    'funding_momentum',
    'competitor_weakness',
    'demand_acceleration'
  ));

ALTER TABLE marketpulse_opportunity_intelligence
  ADD COLUMN IF NOT EXISTS quality_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS degraded_context BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS degradation_reasons TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE marketpulse_comparative_intelligence
  ADD COLUMN IF NOT EXISTS comparison_window TEXT NOT NULL DEFAULT 'latest',
  ADD COLUMN IF NOT EXISTS peer_relative_readiness JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS industry_baseline_readiness JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS sector_relative_interpretation JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS marketpulse_operational_validation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  validation_type TEXT NOT NULL,
  validation_status TEXT NOT NULL DEFAULT 'warning',
  entity_type TEXT NULL,
  entity_id UUID NULL,
  finding_summary TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  remediation_hint TEXT,
  validation_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT marketpulse_validation_type_valid
    CHECK (validation_type IN ('orphan_investigation', 'stale_escalation', 'lifecycle_inconsistency', 'invalid_escalation', 'low_confidence_noise', 'oversized_payload', 'visibility_risk')),
  CONSTRAINT marketpulse_validation_status_valid
    CHECK (validation_status IN ('ok', 'warning', 'critical', 'suppressed')),
  CONSTRAINT marketpulse_validation_severity_valid
    CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT marketpulse_validation_payload_object
    CHECK (jsonb_typeof(validation_payload) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_marketpulse_validation_company
  ON marketpulse_operational_validation_events(company_id, validation_type, created_at DESC);

CREATE TABLE IF NOT EXISTS marketpulse_historical_timeline_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  event_summary TEXT NOT NULL,
  severity NUMERIC(5,2),
  confidence NUMERIC(5,2),
  lifecycle_state TEXT,
  event_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT marketpulse_timeline_payload_object
    CHECK (jsonb_typeof(event_payload) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_marketpulse_timeline_company
  ON marketpulse_historical_timeline_events(company_id, occurred_at DESC);

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'marketpulse_operational_validation_events',
    'marketpulse_historical_timeline_events'
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

COMMIT;

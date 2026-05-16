BEGIN;

-- MarketPulse Phase 3: business impact propagation, pressure amplification,
-- materiality scoring, operational consequences, and executive framing.

CREATE TABLE IF NOT EXISTS marketpulse_business_impacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source_signal_id UUID REFERENCES marketpulse_signals(id) ON DELETE SET NULL,
  source_trend_id UUID REFERENCES marketpulse_trends(id) ON DELETE SET NULL,
  source_pressure_id UUID REFERENCES marketpulse_business_pressures(id) ON DELETE SET NULL,
  impact_area TEXT NOT NULL,
  impact_type TEXT NOT NULL,
  impact_direction TEXT NOT NULL,
  severity NUMERIC(5,2) NOT NULL DEFAULT 0,
  confidence NUMERIC(5,2) NOT NULL DEFAULT 0,
  materiality_level TEXT NOT NULL DEFAULT 'informational',
  affected_business_units TEXT[] NOT NULL DEFAULT '{}',
  affected_dependencies TEXT[] NOT NULL DEFAULT '{}',
  affected_geographies TEXT[] NOT NULL DEFAULT '{}',
  affected_workforce_segments TEXT[] NOT NULL DEFAULT '{}',
  affected_customer_segments TEXT[] NOT NULL DEFAULT '{}',
  rationale TEXT NOT NULL,
  executive_framing JSONB NOT NULL DEFAULT '{}'::jsonb,
  uncertainty_factors TEXT[] NOT NULL DEFAULT '{}',
  contradiction_factors TEXT[] NOT NULL DEFAULT '{}',
  evolution_status TEXT NOT NULL DEFAULT 'new',
  duplicate_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT marketpulse_business_impacts_area_valid
    CHECK (impact_area IN (
      'revenue', 'margin', 'workforce', 'operations', 'compliance', 'supply_chain',
      'technology', 'customer_demand', 'delivery', 'expansion', 'fundraising',
      'retention', 'brand', 'infrastructure', 'vendor_dependency'
    )),
  CONSTRAINT marketpulse_business_impacts_direction_valid
    CHECK (impact_direction IN ('positive', 'negative', 'mixed')),
  CONSTRAINT marketpulse_business_impacts_materiality_valid
    CHECK (materiality_level IN ('informational', 'moderate', 'significant', 'strategic', 'critical')),
  CONSTRAINT marketpulse_business_impacts_evolution_valid
    CHECK (evolution_status IN ('new', 'worsening', 'stabilizing', 'improving', 'compounding', 'decaying')),
  CONSTRAINT marketpulse_business_impacts_scores_valid
    CHECK (severity BETWEEN 0 AND 100 AND confidence BETWEEN 0 AND 100),
  CONSTRAINT marketpulse_business_impacts_framing_object
    CHECK (jsonb_typeof(executive_framing) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_marketpulse_business_impacts_company_duplicate
  ON marketpulse_business_impacts(company_id, duplicate_key)
  WHERE duplicate_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_marketpulse_business_impacts_company_materiality
  ON marketpulse_business_impacts(company_id, materiality_level, severity DESC, updated_at DESC);

CREATE TABLE IF NOT EXISTS marketpulse_pressure_amplifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  primary_pressure_id UUID NOT NULL REFERENCES marketpulse_business_pressures(id) ON DELETE CASCADE,
  secondary_pressure_id UUID NOT NULL REFERENCES marketpulse_business_pressures(id) ON DELETE CASCADE,
  amplification_type TEXT NOT NULL,
  amplification_factor NUMERIC(5,2) NOT NULL DEFAULT 1,
  rationale TEXT NOT NULL,
  confidence NUMERIC(5,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT marketpulse_pressure_amplifications_type_valid
    CHECK (amplification_type IN ('reinforcing', 'cascading', 'offsetting', 'compounding')),
  CONSTRAINT marketpulse_pressure_amplifications_factor_valid
    CHECK (amplification_factor >= 0 AND amplification_factor <= 2),
  CONSTRAINT marketpulse_pressure_amplifications_confidence_valid
    CHECK (confidence BETWEEN 0 AND 100),
  CONSTRAINT marketpulse_pressure_amplifications_unique
    UNIQUE(company_id, primary_pressure_id, secondary_pressure_id, amplification_type)
);

CREATE INDEX IF NOT EXISTS idx_marketpulse_pressure_amplifications_company
  ON marketpulse_pressure_amplifications(company_id, confidence DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS marketpulse_operational_consequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  consequence_type TEXT NOT NULL,
  severity NUMERIC(5,2) NOT NULL DEFAULT 0,
  confidence NUMERIC(5,2) NOT NULL DEFAULT 0,
  materiality_level TEXT NOT NULL DEFAULT 'informational',
  contributing_impacts UUID[] NOT NULL DEFAULT '{}',
  contributing_pressures UUID[] NOT NULL DEFAULT '{}',
  rationale TEXT NOT NULL,
  executive_framing JSONB NOT NULL DEFAULT '{}'::jsonb,
  uncertainty_factors TEXT[] NOT NULL DEFAULT '{}',
  contradiction_factors TEXT[] NOT NULL DEFAULT '{}',
  evolution_status TEXT NOT NULL DEFAULT 'new',
  duplicate_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT marketpulse_operational_consequences_type_valid
    CHECK (consequence_type IN (
      'delivery_slowdown_risk', 'hiring_delay', 'margin_compression',
      'customer_acquisition_slowdown', 'compliance_overhead_increase',
      'operational_bottleneck', 'expansion_friction', 'workforce_attrition_risk',
      'vendor_cost_increase', 'infrastructure_reliability_risk'
    )),
  CONSTRAINT marketpulse_operational_consequences_materiality_valid
    CHECK (materiality_level IN ('informational', 'moderate', 'significant', 'strategic', 'critical')),
  CONSTRAINT marketpulse_operational_consequences_evolution_valid
    CHECK (evolution_status IN ('new', 'worsening', 'stabilizing', 'improving', 'compounding', 'decaying')),
  CONSTRAINT marketpulse_operational_consequences_scores_valid
    CHECK (severity BETWEEN 0 AND 100 AND confidence BETWEEN 0 AND 100),
  CONSTRAINT marketpulse_operational_consequences_framing_object
    CHECK (jsonb_typeof(executive_framing) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_marketpulse_operational_consequences_company_duplicate
  ON marketpulse_operational_consequences(company_id, duplicate_key)
  WHERE duplicate_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_marketpulse_operational_consequences_company
  ON marketpulse_operational_consequences(company_id, severity DESC, updated_at DESC);

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'marketpulse_business_impacts',
    'marketpulse_pressure_amplifications',
    'marketpulse_operational_consequences'
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

DROP TRIGGER IF EXISTS trg_marketpulse_business_impacts_updated_at ON marketpulse_business_impacts;
CREATE TRIGGER trg_marketpulse_business_impacts_updated_at
BEFORE UPDATE ON marketpulse_business_impacts
FOR EACH ROW EXECUTE FUNCTION omnivyra_touch_updated_at();

DROP TRIGGER IF EXISTS trg_marketpulse_operational_consequences_updated_at ON marketpulse_operational_consequences;
CREATE TRIGGER trg_marketpulse_operational_consequences_updated_at
BEFORE UPDATE ON marketpulse_operational_consequences
FOR EACH ROW EXECUTE FUNCTION omnivyra_touch_updated_at();

COMMIT;

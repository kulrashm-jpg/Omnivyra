BEGIN;

-- MarketPulse Phase 2: relationship intelligence, trend aggregation,
-- business pressure synthesis, strategic narratives, and executive digests.
-- This layer remains descriptive/synthetic only; it does not forecast or
-- autonomously recommend strategy.

CREATE TABLE IF NOT EXISTS marketpulse_signal_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_signal_id UUID NOT NULL REFERENCES marketpulse_signals(id) ON DELETE CASCADE,
  related_signal_id UUID NOT NULL REFERENCES marketpulse_signals(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL,
  confidence NUMERIC(5,2) NOT NULL DEFAULT 50,
  rationale TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT marketpulse_signal_relationships_type_valid
    CHECK (relationship_type IN ('causes', 'supports', 'contradicts', 'amplifies', 'reduces', 'precedes', 'follows', 'correlates_with')),
  CONSTRAINT marketpulse_signal_relationships_confidence_valid
    CHECK (confidence BETWEEN 0 AND 100),
  CONSTRAINT marketpulse_signal_relationships_unique
    UNIQUE(parent_signal_id, related_signal_id, relationship_type)
);

CREATE INDEX IF NOT EXISTS idx_marketpulse_signal_relationships_parent
  ON marketpulse_signal_relationships(parent_signal_id, relationship_type);

CREATE INDEX IF NOT EXISTS idx_marketpulse_signal_relationships_related
  ON marketpulse_signal_relationships(related_signal_id);

CREATE TABLE IF NOT EXISTS marketpulse_trends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trend_category TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  involved_signal_count INTEGER NOT NULL DEFAULT 0,
  signal_velocity NUMERIC(6,2) NOT NULL DEFAULT 0,
  confidence NUMERIC(5,2) NOT NULL DEFAULT 0,
  trend_direction TEXT NOT NULL DEFAULT 'emerging',
  trend_pattern TEXT NOT NULL DEFAULT 'isolated_event',
  affected_industries TEXT[] NOT NULL DEFAULT '{}',
  affected_geographies TEXT[] NOT NULL DEFAULT '{}',
  impact_domains TEXT[] NOT NULL DEFAULT '{}',
  supporting_signals UUID[] NOT NULL DEFAULT '{}',
  contradictory_signals UUID[] NOT NULL DEFAULT '{}',
  causal_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT marketpulse_trends_direction_valid
    CHECK (trend_direction IN ('accelerating', 'stable', 'slowing', 'emerging')),
  CONSTRAINT marketpulse_trends_pattern_valid
    CHECK (trend_pattern IN ('isolated_event', 'recurring_pattern', 'structural_trend')),
  CONSTRAINT marketpulse_trends_confidence_valid
    CHECK (confidence BETWEEN 0 AND 100)
);

CREATE INDEX IF NOT EXISTS idx_marketpulse_trends_category_updated
  ON marketpulse_trends(trend_category, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_marketpulse_trends_supporting_signals
  ON marketpulse_trends USING GIN(supporting_signals);

CREATE TABLE IF NOT EXISTS marketpulse_business_pressures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  pressure_type TEXT NOT NULL,
  pressure_direction TEXT NOT NULL,
  severity NUMERIC(5,2) NOT NULL DEFAULT 0,
  confidence NUMERIC(5,2) NOT NULL DEFAULT 0,
  contributing_signals UUID[] NOT NULL DEFAULT '{}',
  contributing_trends UUID[] NOT NULL DEFAULT '{}',
  rationale TEXT NOT NULL,
  affected_business_areas TEXT[] NOT NULL DEFAULT '{}',
  causal_chain JSONB NOT NULL DEFAULT '[]'::jsonb,
  uncertainty_factors TEXT[] NOT NULL DEFAULT '{}',
  contradictory_factors TEXT[] NOT NULL DEFAULT '{}',
  synthesis_strength TEXT NOT NULL DEFAULT 'weak',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT marketpulse_business_pressures_type_valid
    CHECK (pressure_type IN (
      'hiring_pressure', 'compliance_pressure', 'margin_pressure', 'logistics_pressure',
      'supply_chain_pressure', 'competitive_pressure', 'pricing_pressure',
      'investor_pressure', 'operational_pressure', 'technology_pressure',
      'geopolitical_pressure'
    )),
  CONSTRAINT marketpulse_business_pressures_direction_valid
    CHECK (pressure_direction IN ('increasing', 'decreasing', 'mixed', 'stable')),
  CONSTRAINT marketpulse_business_pressures_strength_valid
    CHECK (synthesis_strength IN ('weak', 'moderate', 'strong')),
  CONSTRAINT marketpulse_business_pressures_scores_valid
    CHECK (severity BETWEEN 0 AND 100 AND confidence BETWEEN 0 AND 100),
  CONSTRAINT marketpulse_business_pressures_chain_array
    CHECK (jsonb_typeof(causal_chain) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_marketpulse_business_pressures_company
  ON marketpulse_business_pressures(company_id, severity DESC, updated_at DESC);

CREATE TABLE IF NOT EXISTS marketpulse_narratives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  narrative_type TEXT NOT NULL,
  title TEXT NOT NULL,
  narrative_summary TEXT NOT NULL,
  supporting_signals UUID[] NOT NULL DEFAULT '{}',
  supporting_trends UUID[] NOT NULL DEFAULT '{}',
  supporting_pressures UUID[] NOT NULL DEFAULT '{}',
  confidence NUMERIC(5,2) NOT NULL DEFAULT 0,
  severity NUMERIC(5,2) NOT NULL DEFAULT 0,
  time_horizon TEXT NOT NULL DEFAULT 'near_term',
  causal_chain JSONB NOT NULL DEFAULT '[]'::jsonb,
  uncertainty_factors TEXT[] NOT NULL DEFAULT '{}',
  contradictory_factors TEXT[] NOT NULL DEFAULT '{}',
  duplicate_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT marketpulse_narratives_time_horizon_valid
    CHECK (time_horizon IN ('immediate', 'near_term', 'long_term')),
  CONSTRAINT marketpulse_narratives_scores_valid
    CHECK (confidence BETWEEN 0 AND 100 AND severity BETWEEN 0 AND 100),
  CONSTRAINT marketpulse_narratives_chain_array
    CHECK (jsonb_typeof(causal_chain) = 'array')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_marketpulse_narratives_company_duplicate
  ON marketpulse_narratives(company_id, duplicate_key)
  WHERE duplicate_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_marketpulse_narratives_company
  ON marketpulse_narratives(company_id, severity DESC, updated_at DESC);

CREATE TABLE IF NOT EXISTS marketpulse_intelligence_digests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  digest_type TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  major_pressures UUID[] NOT NULL DEFAULT '{}',
  strategic_opportunities UUID[] NOT NULL DEFAULT '{}',
  emerging_risks UUID[] NOT NULL DEFAULT '{}',
  trend_shifts UUID[] NOT NULL DEFAULT '{}',
  market_momentum TEXT NOT NULL DEFAULT 'mixed',
  confidence NUMERIC(5,2) NOT NULL DEFAULT 0,
  insight_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT marketpulse_intelligence_digests_type_valid
    CHECK (digest_type IN ('executive', 'operational', 'funding', 'workforce', 'compliance', 'macroeconomic', 'industry_specific')),
  CONSTRAINT marketpulse_intelligence_digests_confidence_valid
    CHECK (confidence BETWEEN 0 AND 100),
  CONSTRAINT marketpulse_intelligence_digests_payload_object
    CHECK (jsonb_typeof(insight_payload) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_marketpulse_intelligence_digests_company
  ON marketpulse_intelligence_digests(company_id, digest_type, created_at DESC);

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'marketpulse_signal_relationships',
    'marketpulse_trends',
    'marketpulse_business_pressures',
    'marketpulse_narratives',
    'marketpulse_intelligence_digests'
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

DROP TRIGGER IF EXISTS trg_marketpulse_trends_updated_at ON marketpulse_trends;
CREATE TRIGGER trg_marketpulse_trends_updated_at
BEFORE UPDATE ON marketpulse_trends
FOR EACH ROW EXECUTE FUNCTION omnivyra_touch_updated_at();

DROP TRIGGER IF EXISTS trg_marketpulse_business_pressures_updated_at ON marketpulse_business_pressures;
CREATE TRIGGER trg_marketpulse_business_pressures_updated_at
BEFORE UPDATE ON marketpulse_business_pressures
FOR EACH ROW EXECUTE FUNCTION omnivyra_touch_updated_at();

DROP TRIGGER IF EXISTS trg_marketpulse_narratives_updated_at ON marketpulse_narratives;
CREATE TRIGGER trg_marketpulse_narratives_updated_at
BEFORE UPDATE ON marketpulse_narratives
FOR EACH ROW EXECUTE FUNCTION omnivyra_touch_updated_at();

COMMIT;

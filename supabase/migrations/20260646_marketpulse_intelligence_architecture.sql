BEGIN;

-- MarketPulse Phase 1: normalized signal architecture, impact separation,
-- company relevance persistence, adaptive feed support, and lightweight
-- personalization controls. This is additive and does not implement
-- predictive forecasting or autonomous strategy.

CREATE TABLE IF NOT EXISTS marketpulse_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_type TEXT NOT NULL,
  signal_category TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  source_url TEXT,
  source_name TEXT,
  source_type TEXT NOT NULL DEFAULT 'system',
  source_credibility NUMERIC(5,2) NOT NULL DEFAULT 50,
  geography TEXT,
  industries TEXT[] NOT NULL DEFAULT '{}',
  affected_domains TEXT[] NOT NULL DEFAULT '{}',
  affected_functions TEXT[] NOT NULL DEFAULT '{}',
  tags TEXT[] NOT NULL DEFAULT '{}',
  published_at TIMESTAMPTZ,
  freshness_score NUMERIC(5,2) NOT NULL DEFAULT 50,
  urgency_level TEXT NOT NULL DEFAULT 'medium',
  novelty_score NUMERIC(5,2) NOT NULL DEFAULT 50,
  confidence_score NUMERIC(5,2) NOT NULL DEFAULT 50,
  causality_summary TEXT,
  strategic_operational_class TEXT NOT NULL DEFAULT 'operational',
  opportunity_risk_class TEXT NOT NULL DEFAULT 'mixed',
  time_horizon_class TEXT NOT NULL DEFAULT 'immediate',
  relevance_scope_class TEXT NOT NULL DEFAULT 'indirect',
  locality_class TEXT NOT NULL DEFAULT 'global',
  duplicate_key TEXT,
  conflict_group_key TEXT,
  weak_signal BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT marketpulse_signals_category_valid
    CHECK (signal_category IN (
      'regulation', 'funding', 'hiring', 'labor', 'macroeconomics', 'geopolitics',
      'supply_chain', 'commodity', 'technology', 'AI', 'cybersecurity', 'cloud',
      'competitor', 'mergers_acquisitions', 'market_sentiment', 'consumer_behavior',
      'logistics', 'taxation', 'currency', 'exports_imports', 'compliance',
      'infrastructure', 'energy', 'public_policy', 'investor_activity'
    )),
  CONSTRAINT marketpulse_signals_urgency_valid
    CHECK (urgency_level IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT marketpulse_signals_strategy_valid
    CHECK (strategic_operational_class IN ('strategic', 'operational', 'mixed')),
  CONSTRAINT marketpulse_signals_opportunity_valid
    CHECK (opportunity_risk_class IN ('opportunity', 'risk', 'mixed')),
  CONSTRAINT marketpulse_signals_horizon_valid
    CHECK (time_horizon_class IN ('immediate', 'long_term', 'mixed')),
  CONSTRAINT marketpulse_signals_scope_valid
    CHECK (relevance_scope_class IN ('direct', 'indirect')),
  CONSTRAINT marketpulse_signals_locality_valid
    CHECK (locality_class IN ('local', 'global', 'regional')),
  CONSTRAINT marketpulse_signals_score_bounds
    CHECK (
      source_credibility BETWEEN 0 AND 100 AND
      freshness_score BETWEEN 0 AND 100 AND
      novelty_score BETWEEN 0 AND 100 AND
      confidence_score BETWEEN 0 AND 100
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_marketpulse_signals_duplicate_key
  ON marketpulse_signals(duplicate_key)
  WHERE duplicate_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_marketpulse_signals_category_freshness
  ON marketpulse_signals(signal_category, published_at DESC, freshness_score DESC);

CREATE INDEX IF NOT EXISTS idx_marketpulse_signals_tags
  ON marketpulse_signals USING GIN(tags);

CREATE TABLE IF NOT EXISTS marketpulse_signal_impacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id UUID NOT NULL REFERENCES marketpulse_signals(id) ON DELETE CASCADE,
  impact_type TEXT NOT NULL,
  impact_direction TEXT NOT NULL,
  severity NUMERIC(5,2) NOT NULL DEFAULT 50,
  confidence NUMERIC(5,2) NOT NULL DEFAULT 50,
  rationale TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT marketpulse_signal_impacts_type_valid
    CHECK (impact_type IN ('revenue', 'cost', 'operations', 'workforce', 'compliance', 'supply_chain', 'technology', 'brand', 'strategy')),
  CONSTRAINT marketpulse_signal_impacts_direction_valid
    CHECK (impact_direction IN ('positive', 'negative', 'mixed')),
  CONSTRAINT marketpulse_signal_impacts_score_bounds
    CHECK (severity BETWEEN 0 AND 100 AND confidence BETWEEN 0 AND 100)
);

CREATE INDEX IF NOT EXISTS idx_marketpulse_signal_impacts_signal
  ON marketpulse_signal_impacts(signal_id);

CREATE TABLE IF NOT EXISTS marketpulse_company_signal_relevance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  signal_id UUID NOT NULL REFERENCES marketpulse_signals(id) ON DELETE CASCADE,
  relevance_score NUMERIC(5,2) NOT NULL DEFAULT 0,
  exposure_score NUMERIC(5,2) NOT NULL DEFAULT 0,
  dependency_score NUMERIC(5,2) NOT NULL DEFAULT 0,
  geography_score NUMERIC(5,2) NOT NULL DEFAULT 0,
  workforce_score NUMERIC(5,2) NOT NULL DEFAULT 0,
  regulatory_score NUMERIC(5,2) NOT NULL DEFAULT 0,
  strategic_priority_score NUMERIC(5,2) NOT NULL DEFAULT 0,
  confidence_score NUMERIC(5,2) NOT NULL DEFAULT 0,
  degraded_context BOOLEAN NOT NULL DEFAULT false,
  degradation_reasons TEXT[] NOT NULL DEFAULT '{}',
  explanation_summary TEXT NOT NULL DEFAULT '',
  explanation_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  digest_types TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT marketpulse_company_signal_relevance_unique UNIQUE(company_id, signal_id),
  CONSTRAINT marketpulse_company_signal_relevance_scores
    CHECK (
      relevance_score BETWEEN 0 AND 100 AND exposure_score BETWEEN 0 AND 100 AND
      dependency_score BETWEEN 0 AND 100 AND geography_score BETWEEN 0 AND 100 AND
      workforce_score BETWEEN 0 AND 100 AND regulatory_score BETWEEN 0 AND 100 AND
      strategic_priority_score BETWEEN 0 AND 100 AND confidence_score BETWEEN 0 AND 100
    ),
  CONSTRAINT marketpulse_company_signal_relevance_payload_object
    CHECK (jsonb_typeof(explanation_payload) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_marketpulse_company_signal_relevance_company_score
  ON marketpulse_company_signal_relevance(company_id, relevance_score DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS marketpulse_personalization_controls (
  company_id UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  follow_topics TEXT[] NOT NULL DEFAULT '{}',
  mute_topics TEXT[] NOT NULL DEFAULT '{}',
  prioritize_categories TEXT[] NOT NULL DEFAULT '{}',
  follow_competitors TEXT[] NOT NULL DEFAULT '{}',
  follow_regions TEXT[] NOT NULL DEFAULT '{}',
  reduce_operational_noise BOOLEAN NOT NULL DEFAULT false,
  increase_strategic_alerts BOOLEAN NOT NULL DEFAULT false,
  updated_by UUID NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'marketpulse_signals',
    'marketpulse_signal_impacts',
    'marketpulse_company_signal_relevance',
    'marketpulse_personalization_controls'
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

DROP TRIGGER IF EXISTS trg_marketpulse_signals_updated_at ON marketpulse_signals;
CREATE TRIGGER trg_marketpulse_signals_updated_at
BEFORE UPDATE ON marketpulse_signals
FOR EACH ROW EXECUTE FUNCTION omnivyra_touch_updated_at();

DROP TRIGGER IF EXISTS trg_marketpulse_personalization_controls_updated_at ON marketpulse_personalization_controls;
CREATE TRIGGER trg_marketpulse_personalization_controls_updated_at
BEFORE UPDATE ON marketpulse_personalization_controls
FOR EACH ROW EXECUTE FUNCTION omnivyra_touch_updated_at();

COMMIT;

-- =====================================================
-- SCHEDULING INTELLIGENCE SIGNALS — Phase 6A
-- Signal store for scheduling influence (trends, events, news)
-- Does NOT modify schedules; stores and scores signals only.
-- =====================================================

CREATE TABLE IF NOT EXISTS scheduling_intelligence_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  signal_type TEXT NOT NULL,
  signal_source TEXT NOT NULL,
  signal_topic TEXT NOT NULL,
  signal_score NUMERIC NOT NULL DEFAULT 0,
  signal_timestamp TIMESTAMPTZ NOT NULL,
  metadata JSONB NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Signal types: industry_trend, competitor_activity, company_event, seasonal_event, market_news
CREATE INDEX IF NOT EXISTS idx_scheduling_signals_company_time
  ON scheduling_intelligence_signals (company_id, signal_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_scheduling_signals_company_score
  ON scheduling_intelligence_signals (company_id, signal_score DESC);

CREATE INDEX IF NOT EXISTS idx_scheduling_signals_type
  ON scheduling_intelligence_signals (signal_type)
  WHERE signal_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_scheduling_signals_week_range
  ON scheduling_intelligence_signals (company_id, signal_timestamp)
  WHERE signal_timestamp IS NOT NULL;

COMMENT ON TABLE scheduling_intelligence_signals IS 'Phase 6A: Signals for scheduling influence. Used by signalIntelligenceEngine.';

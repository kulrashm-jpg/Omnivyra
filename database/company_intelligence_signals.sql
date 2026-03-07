-- =====================================================
-- COMPANY INTELLIGENCE SIGNALS
-- Phase 2: Company-specific signals derived from global intelligence_signals
-- =====================================================
-- Run after: intelligence_signals (must exist)
-- =====================================================

CREATE TABLE IF NOT EXISTS company_intelligence_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  signal_id UUID NOT NULL REFERENCES intelligence_signals(id) ON DELETE CASCADE,
  relevance_score NUMERIC NULL,
  impact_score NUMERIC NULL,
  signal_type TEXT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (company_id, signal_id)
);

-- Index for company lookup
CREATE INDEX IF NOT EXISTS index_company_intelligence_signals_company
  ON company_intelligence_signals (company_id);

-- Index for signal lookup
CREATE INDEX IF NOT EXISTS index_company_intelligence_signals_signal
  ON company_intelligence_signals (signal_id);

-- Index for company relevance ordering
CREATE INDEX IF NOT EXISTS index_company_intelligence_signals_company_relevance
  ON company_intelligence_signals (company_id, relevance_score DESC NULLS LAST);

-- Index for time-based queries (via created_at)
CREATE INDEX IF NOT EXISTS index_company_intelligence_signals_company_created
  ON company_intelligence_signals (company_id, created_at DESC);

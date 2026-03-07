-- =====================================================
-- COMPANY INTELLIGENCE SIGNALS — Dashboard Performance Indexes
-- Phase-4 Final Hardening: query safety and indexing
-- =====================================================
-- Run after: company_intelligence_signals_phase4.sql
-- =====================================================

-- 1. Dashboard query index
CREATE INDEX IF NOT EXISTS idx_company_signals_dashboard
  ON company_intelligence_signals (company_id, signal_score DESC NULLS LAST, created_at DESC);

-- 2. Priority filtering index
CREATE INDEX IF NOT EXISTS idx_company_signals_priority
  ON company_intelligence_signals (company_id, priority_level, signal_score DESC NULLS LAST);

-- 3. Competitor signal lookup index
CREATE INDEX IF NOT EXISTS idx_company_signals_competitors
  ON company_intelligence_signals USING GIN (matched_competitors);

-- 4. Topic lookup index
CREATE INDEX IF NOT EXISTS idx_company_signals_topics
  ON company_intelligence_signals USING GIN (matched_topics);

-- 5. Region lookup index
CREATE INDEX IF NOT EXISTS idx_company_signals_regions
  ON company_intelligence_signals USING GIN (matched_regions);

-- 6. Dashboard window index (range filter + ordering)
CREATE INDEX IF NOT EXISTS idx_company_signals_dashboard_window
  ON company_intelligence_signals (company_id, created_at DESC, signal_score DESC NULLS LAST);

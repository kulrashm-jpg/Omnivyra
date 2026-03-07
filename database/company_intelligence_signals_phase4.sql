-- =====================================================
-- COMPANY INTELLIGENCE SIGNALS — Phase-4 Fields
-- Adds signal_score, priority_level, matched_topics, matched_competitors, matched_regions
-- =====================================================
-- Run after: company_intelligence_signals.sql
-- =====================================================

ALTER TABLE company_intelligence_signals
  ADD COLUMN IF NOT EXISTS signal_score NUMERIC NULL;

ALTER TABLE company_intelligence_signals
  ADD COLUMN IF NOT EXISTS priority_level TEXT NULL;

ALTER TABLE company_intelligence_signals
  ADD COLUMN IF NOT EXISTS matched_topics TEXT[] NULL;

ALTER TABLE company_intelligence_signals
  ADD COLUMN IF NOT EXISTS matched_competitors TEXT[] NULL;

ALTER TABLE company_intelligence_signals
  ADD COLUMN IF NOT EXISTS matched_regions TEXT[] NULL;

CREATE INDEX IF NOT EXISTS index_company_intelligence_signals_company_priority
  ON company_intelligence_signals (company_id, priority_level)
  WHERE priority_level IS NOT NULL;

CREATE INDEX IF NOT EXISTS index_company_intelligence_signals_company_signal_score
  ON company_intelligence_signals (company_id, signal_score DESC NULLS LAST);

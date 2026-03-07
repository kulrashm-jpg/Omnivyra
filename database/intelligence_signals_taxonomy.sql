-- =====================================================
-- INTELLIGENCE SIGNALS TAXONOMY EXTENSION
-- Phase 1: Global Intelligence Layer
-- =====================================================
-- Run after: intelligence_signals.sql
-- =====================================================

ALTER TABLE intelligence_signals
  ADD COLUMN IF NOT EXISTS primary_category TEXT NULL;

ALTER TABLE intelligence_signals
  ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'::jsonb;

ALTER TABLE intelligence_signals
  ADD COLUMN IF NOT EXISTS relevance_score NUMERIC NULL;

-- Supported taxonomy values: TREND, COMPETITOR, PRODUCT, CUSTOMER, MARKETING, PARTNERSHIP, LEADERSHIP, REGULATION, EVENT
-- No backfill required. Existing signals remain unchanged.

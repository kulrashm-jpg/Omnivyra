-- =====================================================
-- INTELLIGENCE CATEGORIES (Governance Layer)
-- Phase-2: Super Admin Governance
-- =====================================================
-- Governance only. signalRelevanceEngine continues using TAXONOMY_VALUES.
-- This table drives admin UI validation and display.
-- =====================================================

CREATE TABLE IF NOT EXISTS intelligence_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS index_intelligence_categories_name
  ON intelligence_categories (name);
CREATE INDEX IF NOT EXISTS index_intelligence_categories_enabled
  ON intelligence_categories (enabled) WHERE enabled = true;

-- Seed with taxonomy values from signalRelevanceEngine.TAXONOMY_VALUES
INSERT INTO intelligence_categories (name, description, enabled)
VALUES
  ('TREND', 'Market, trend, and growth signals', true),
  ('COMPETITOR', 'Competitor activity and mentions', true),
  ('PRODUCT', 'Product-related signals', true),
  ('CUSTOMER', 'Customer feedback and complaints', true),
  ('MARKETING', 'Marketing, campaign, and brand signals', true),
  ('PARTNERSHIP', 'Partner and collaboration signals', true),
  ('LEADERSHIP', 'Leadership and executive strategy signals', true),
  ('REGULATION', 'Regulation, compliance, and policy signals', true),
  ('EVENT', 'Events, launches, and conferences', true)
ON CONFLICT (name) DO NOTHING;

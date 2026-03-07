-- =====================================================
-- INTELLIGENCE QUERY TEMPLATES
-- Phase 1: Global Intelligence Layer
-- =====================================================
-- Run after: external_api_sources
-- =====================================================

CREATE TABLE IF NOT EXISTS intelligence_query_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_source_id UUID NULL REFERENCES external_api_sources(id) ON DELETE SET NULL,
  category TEXT,
  template TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS index_intelligence_query_templates_api_source
  ON intelligence_query_templates (api_source_id);

CREATE INDEX IF NOT EXISTS index_intelligence_query_templates_enabled
  ON intelligence_query_templates (enabled) WHERE enabled = true;

-- Default global templates (api_source_id = NULL)
INSERT INTO intelligence_query_templates (api_source_id, category, template, enabled)
VALUES
  (NULL, 'trend', '{topic} market trends {region}', true),
  (NULL, 'competitor', '{competitor} product launch', true),
  (NULL, 'product', 'problems with {product}', true),
  (NULL, 'strategy', '{topic} marketing strategy', true),
  (NULL, 'customer', '{topic} customer complaints', true);

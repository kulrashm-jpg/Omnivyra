-- =====================================================
-- COMPANY API CONFIGS (Company-level API configuration)
-- Per-company snapshot when enabling a preset API.
-- =====================================================
-- Run after: external-api-sources.sql, companies
-- =====================================================

CREATE TABLE IF NOT EXISTS company_api_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  api_source_id UUID NOT NULL REFERENCES external_api_sources(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT true,
  polling_frequency TEXT,
  priority TEXT,
  daily_limit INTEGER,
  signal_limit INTEGER,
  purposes JSONB DEFAULT '[]'::jsonb,
  include_filters JSONB DEFAULT '{}'::jsonb,
  exclude_filters JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT company_api_configs_company_source_unique UNIQUE (company_id, api_source_id),
  CONSTRAINT company_api_configs_polling_check CHECK (
    polling_frequency IS NULL OR polling_frequency IN ('realtime', '2h', '6h', 'daily', 'weekly')
  ),
  CONSTRAINT company_api_configs_priority_check CHECK (
    priority IS NULL OR priority IN ('HIGH', 'MEDIUM', 'LOW')
  )
);

CREATE INDEX IF NOT EXISTS index_company_api_configs_company
  ON company_api_configs (company_id);

CREATE INDEX IF NOT EXISTS index_company_api_configs_api_source
  ON company_api_configs (api_source_id);

CREATE INDEX IF NOT EXISTS index_company_api_configs_company_enabled
  ON company_api_configs (company_id, enabled) WHERE enabled = true;

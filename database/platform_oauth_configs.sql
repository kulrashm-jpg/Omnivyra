-- =====================================================
-- Platform OAuth Configs (Layer 1 — Global OAuth)
-- =====================================================
-- Super Admin configures OAuth credentials once globally.
-- Tenant companies never enter client IDs or secrets.
-- All OAuth flows resolve credentials from this table (or .env fallback).
--
-- Run: psql $SUPABASE_DB_URL -f database/platform_oauth_configs.sql
-- =====================================================

CREATE TABLE IF NOT EXISTS platform_oauth_configs (
  platform VARCHAR(50) PRIMARY KEY,
  oauth_client_id_encrypted TEXT,
  oauth_client_secret_encrypted TEXT,
  oauth_authorize_url TEXT,
  oauth_token_url TEXT,
  oauth_scopes TEXT[] DEFAULT '{}',
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE platform_oauth_configs IS 'Global OAuth credentials for social platforms. Super Admin only. Tenants never configure.';

CREATE INDEX IF NOT EXISTS idx_platform_oauth_configs_enabled
  ON platform_oauth_configs(enabled) WHERE enabled = true;

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_platform_oauth_configs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_platform_oauth_configs_updated_at ON platform_oauth_configs;
CREATE TRIGGER update_platform_oauth_configs_updated_at
  BEFORE UPDATE ON platform_oauth_configs
  FOR EACH ROW EXECUTE FUNCTION update_platform_oauth_configs_updated_at();

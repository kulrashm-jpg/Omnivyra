-- =====================================================
-- Add OAuth credentials to external_api_sources
-- Enables per-company OAuth config (Client ID/Secret) stored encrypted
-- Run after: external-api-sources.sql
-- =====================================================

ALTER TABLE external_api_sources
ADD COLUMN IF NOT EXISTS oauth_client_id_encrypted TEXT;

ALTER TABLE external_api_sources
ADD COLUMN IF NOT EXISTS oauth_client_secret_encrypted TEXT;

COMMENT ON COLUMN external_api_sources.oauth_client_id_encrypted IS 'AES-256-GCM encrypted OAuth Client ID for per-company config';
COMMENT ON COLUMN external_api_sources.oauth_client_secret_encrypted IS 'AES-256-GCM encrypted OAuth Client Secret for per-company config';

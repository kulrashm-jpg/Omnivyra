-- =====================================================
-- EXTERNAL API SOURCES (Trend & Signal Registry)
-- =====================================================
CREATE TABLE IF NOT EXISTS external_api_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    purpose TEXT NOT NULL,
    category TEXT,
    is_active BOOLEAN DEFAULT true,
    method TEXT DEFAULT 'GET',
    auth_type TEXT DEFAULT 'none',
    api_key_name TEXT,
    api_key_env_name TEXT,
    headers JSONB DEFAULT '{}'::jsonb,
    query_params JSONB DEFAULT '{}'::jsonb,
    is_preset BOOLEAN DEFAULT false,
    retry_count INTEGER DEFAULT 2,
    timeout_ms INTEGER DEFAULT 8000,
    rate_limit_per_min INTEGER DEFAULT 60,
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE external_api_sources
ADD COLUMN IF NOT EXISTS platform_type TEXT DEFAULT 'social';

ALTER TABLE external_api_sources
ADD COLUMN IF NOT EXISTS method TEXT DEFAULT 'GET';

ALTER TABLE external_api_sources
ADD COLUMN IF NOT EXISTS headers JSONB DEFAULT '{}'::jsonb;

ALTER TABLE external_api_sources
ADD COLUMN IF NOT EXISTS query_params JSONB DEFAULT '{}'::jsonb;

ALTER TABLE external_api_sources
ADD COLUMN IF NOT EXISTS api_key_env_name TEXT;

ALTER TABLE external_api_sources
ADD COLUMN IF NOT EXISTS is_preset BOOLEAN DEFAULT false;

ALTER TABLE external_api_sources
ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 2;

ALTER TABLE external_api_sources
ADD COLUMN IF NOT EXISTS timeout_ms INTEGER DEFAULT 8000;

ALTER TABLE external_api_sources
ADD COLUMN IF NOT EXISTS rate_limit_per_min INTEGER DEFAULT 60;

ALTER TABLE external_api_sources
ADD COLUMN IF NOT EXISTS supported_content_types JSONB DEFAULT '[]'::jsonb;

ALTER TABLE external_api_sources
ADD COLUMN IF NOT EXISTS promotion_modes JSONB DEFAULT '[]'::jsonb;

ALTER TABLE external_api_sources
ADD COLUMN IF NOT EXISTS required_metadata JSONB DEFAULT '{}'::jsonb;

ALTER TABLE external_api_sources
ADD COLUMN IF NOT EXISTS posting_constraints JSONB DEFAULT '{}'::jsonb;

ALTER TABLE external_api_sources
ADD COLUMN IF NOT EXISTS requires_admin BOOLEAN DEFAULT true;

ALTER TABLE external_api_sources
ADD COLUMN IF NOT EXISTS company_id UUID;

UPDATE external_api_sources
SET platform_type = 'social'
WHERE platform_type IS NULL;

ALTER TABLE external_api_sources
ALTER COLUMN platform_type SET NOT NULL;

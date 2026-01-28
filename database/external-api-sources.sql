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
    auth_type TEXT DEFAULT 'none',
    api_key_name TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE external_api_sources
ADD COLUMN IF NOT EXISTS platform_type TEXT DEFAULT 'social';

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

UPDATE external_api_sources
SET platform_type = 'social'
WHERE platform_type IS NULL;

ALTER TABLE external_api_sources
ALTER COLUMN platform_type SET NOT NULL;

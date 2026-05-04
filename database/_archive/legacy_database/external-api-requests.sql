-- =====================================================
-- EXTERNAL API SOURCE REQUESTS (User submissions)
-- =====================================================
CREATE TABLE IF NOT EXISTS external_api_source_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    purpose TEXT NOT NULL,
    category TEXT,
    is_active BOOLEAN DEFAULT true,
    method TEXT DEFAULT 'GET',
    auth_type TEXT DEFAULT 'none',
    api_key_env_name TEXT,
    headers JSONB DEFAULT '{}'::jsonb,
    query_params JSONB DEFAULT '{}'::jsonb,
    is_preset BOOLEAN DEFAULT false,
    platform_type TEXT DEFAULT 'social',
    supported_content_types JSONB DEFAULT '[]'::jsonb,
    promotion_modes JSONB DEFAULT '[]'::jsonb,
    required_metadata JSONB DEFAULT '{}'::jsonb,
    posting_constraints JSONB DEFAULT '{}'::jsonb,
    requires_admin BOOLEAN DEFAULT true,
    status TEXT DEFAULT 'pending',
    created_by_user_id TEXT,
    rejection_reason TEXT,
    rejected_at TIMESTAMPTZ,
    approved_by_user_id TEXT,
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_external_api_requests_status
ON external_api_source_requests(status);

CREATE INDEX IF NOT EXISTS idx_external_api_requests_user
ON external_api_source_requests(created_by_user_id);

ALTER TABLE external_api_source_requests
ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

ALTER TABLE external_api_source_requests
ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ;

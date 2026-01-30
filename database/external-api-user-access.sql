-- =====================================================
-- EXTERNAL API USER ACCESS (Per-user configuration)
-- =====================================================
CREATE TABLE IF NOT EXISTS external_api_user_access (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    api_source_id UUID NOT NULL REFERENCES external_api_sources(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    is_enabled BOOLEAN DEFAULT false,
    api_key_env_name TEXT,
    headers_override JSONB DEFAULT '{}'::jsonb,
    query_params_override JSONB DEFAULT '{}'::jsonb,
    rate_limit_per_min INTEGER,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_external_api_user_access_unique
ON external_api_user_access(api_source_id, user_id);

CREATE INDEX IF NOT EXISTS idx_external_api_user_access_user
ON external_api_user_access(user_id);

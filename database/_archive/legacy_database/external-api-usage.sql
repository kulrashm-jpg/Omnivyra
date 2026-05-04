-- =====================================================
-- EXTERNAL API USAGE (Per-day tracking)
-- =====================================================
CREATE TABLE IF NOT EXISTS external_api_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    api_source_id UUID NOT NULL REFERENCES external_api_sources(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    usage_date DATE NOT NULL,
    request_count INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    failure_count INTEGER DEFAULT 0,
    last_failure_at TIMESTAMPTZ,
    last_error_code TEXT,
    last_error_message TEXT,
    last_error_at TIMESTAMPTZ,
    last_success_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(api_source_id, user_id, usage_date)
);

CREATE INDEX IF NOT EXISTS idx_external_api_usage_user
ON external_api_usage(user_id);

CREATE INDEX IF NOT EXISTS idx_external_api_usage_date
ON external_api_usage(usage_date);

ALTER TABLE external_api_usage
ADD COLUMN IF NOT EXISTS last_failure_at TIMESTAMPTZ;

ALTER TABLE external_api_usage
ADD COLUMN IF NOT EXISTS last_error_code TEXT;

ALTER TABLE external_api_usage
ADD COLUMN IF NOT EXISTS last_error_message TEXT;

ALTER TABLE external_api_usage
ADD COLUMN IF NOT EXISTS last_error_at TIMESTAMPTZ;

ALTER TABLE external_api_usage
ADD COLUMN IF NOT EXISTS last_success_at TIMESTAMPTZ;

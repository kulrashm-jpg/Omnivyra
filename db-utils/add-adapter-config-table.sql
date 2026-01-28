-- =====================================================
-- ADD ADAPTER CONFIGURATION TABLE
-- =====================================================
-- Stores user-specific content adapter configurations
-- Run this in Supabase SQL Editor
-- =====================================================

BEGIN;

-- Adapter Configurations Table
CREATE TABLE IF NOT EXISTS adapter_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform VARCHAR(50) NOT NULL,
    auto_truncate BOOLEAN DEFAULT TRUE,
    auto_format_hashtags BOOLEAN DEFAULT TRUE,
    preserve_links BOOLEAN DEFAULT TRUE,
    custom_rules JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, platform)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_adapter_configs_user_id ON adapter_configs(user_id);
CREATE INDEX IF NOT EXISTS idx_adapter_configs_platform ON adapter_configs(platform);

COMMENT ON TABLE adapter_configs IS 'User-specific content adapter configurations for platform formatting';

COMMIT;


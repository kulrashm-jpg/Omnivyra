-- Add missing columns required for global API catalog
ALTER TABLE external_api_sources
ADD COLUMN IF NOT EXISTS is_preset BOOLEAN DEFAULT false;

ALTER TABLE external_api_sources
ADD COLUMN IF NOT EXISTS company_id UUID;

ALTER TABLE external_api_sources
ADD COLUMN IF NOT EXISTS rate_limit_per_min INTEGER;

ALTER TABLE external_api_sources
ADD COLUMN IF NOT EXISTS retry_count INTEGER;

ALTER TABLE external_api_sources
ADD COLUMN IF NOT EXISTS timeout_ms INTEGER;

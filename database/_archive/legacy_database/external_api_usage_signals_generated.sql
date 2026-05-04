-- =====================================================
-- PATCH 8: Add signals_generated to external_api_usage
-- Tracks number of intelligence signals created per API per day.
-- =====================================================

ALTER TABLE external_api_usage
ADD COLUMN IF NOT EXISTS signals_generated INTEGER NOT NULL DEFAULT 0;

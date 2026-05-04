-- Add last test result to external_api_health so health status is derived from last test, not only aggregates.
ALTER TABLE external_api_health ADD COLUMN IF NOT EXISTS last_test_status TEXT;
ALTER TABLE external_api_health ADD COLUMN IF NOT EXISTS last_test_at TIMESTAMPTZ;
ALTER TABLE external_api_health ADD COLUMN IF NOT EXISTS last_test_latency_ms INTEGER;

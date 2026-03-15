-- intelligence_cleanup_progress
-- Tracks resume point for intelligence event cleanup to avoid rescanning entire retention range

CREATE TABLE IF NOT EXISTS intelligence_cleanup_progress (
  job_name TEXT PRIMARY KEY,
  last_processed_created_at TIMESTAMPTZ,
  last_processed_id UUID
);

ALTER TABLE intelligence_cleanup_progress
  ADD COLUMN IF NOT EXISTS last_processed_id UUID;

COMMENT ON TABLE intelligence_cleanup_progress IS 'Resume point for intelligence_event cleanup; allows job to continue from last batch instead of rescanning';
-- Stage 11: Campaign Pre-Planning Gate — defaults for new campaigns
-- Ensures new campaigns start with duration_weeks=NULL, blueprint_status=NULL.
-- Do NOT modify existing migration history. Additive migration.
-- Run in Supabase SQL Editor. Idempotent.

-- Remove default so new rows get NULL unless explicitly set
ALTER TABLE campaigns
  ALTER COLUMN blueprint_status DROP DEFAULT;

-- Unified job lifecycle + progress tracking.
-- Adds progress_stage to all engine job tables.

ALTER TABLE lead_jobs_v1
ADD COLUMN IF NOT EXISTS progress_stage text;

ALTER TABLE market_pulse_jobs_v1
ADD COLUMN IF NOT EXISTS progress_stage text;

ALTER TABLE recommendation_jobs_v2
ADD COLUMN IF NOT EXISTS progress_stage text;

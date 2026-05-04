-- Context Mode System: store context_mode, focused_modules, additional_direction for Market Pulse and Lead engines.
-- Required to pass unified context settings from API to async job processors.

ALTER TABLE market_pulse_jobs_v1
ADD COLUMN IF NOT EXISTS context_payload jsonb DEFAULT NULL;

ALTER TABLE lead_jobs_v1
ADD COLUMN IF NOT EXISTS context_payload jsonb DEFAULT NULL;

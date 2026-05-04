-- Fix: model_version VARCHAR(20) overflow
-- The model_version value 'virality-diagnostics-1.1' (25 chars) exceeds VARCHAR(20).
-- No truncation in code; schema evolution only.
-- Safe: ALTER COLUMN TYPE preserves existing data.

ALTER TABLE campaign_virality_assessments
  ALTER COLUMN model_version TYPE TEXT;

COMMENT ON COLUMN campaign_virality_assessments.model_version IS 'Model identifier (e.g. virality-diagnostics-1.1, gpt-4o-mini); TEXT to support variable-length identifiers';

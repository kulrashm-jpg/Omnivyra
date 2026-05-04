-- Stage 8: Campaign Priority Level
-- Adds priority_level to campaigns for governance and preemption suggestions.
-- Allowed values: LOW, NORMAL, HIGH, CRITICAL (no enum constraint for flexibility)

ALTER TABLE campaigns
ADD COLUMN IF NOT EXISTS priority_level VARCHAR(20) DEFAULT 'NORMAL';

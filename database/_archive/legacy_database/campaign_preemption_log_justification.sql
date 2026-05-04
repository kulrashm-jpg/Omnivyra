-- Stage 9C-A: Mandatory preemption justification
-- Add justification column to campaign_preemption_log (immutable once written)

ALTER TABLE campaign_preemption_log
ADD COLUMN IF NOT EXISTS justification TEXT;

-- Backfill existing rows before enforcing NOT NULL
UPDATE campaign_preemption_log
SET justification = 'Historical preemption (no justification required at time).'
WHERE justification IS NULL;

ALTER TABLE campaign_preemption_log
ALTER COLUMN justification SET NOT NULL;

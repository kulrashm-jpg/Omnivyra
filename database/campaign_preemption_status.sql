-- Campaign execution status for controlled preemption
-- Allowed values: ACTIVE, PREEMPTED, PAUSED (no enum constraint for flexibility)

ALTER TABLE campaigns
ADD COLUMN IF NOT EXISTS execution_status VARCHAR(20) DEFAULT 'ACTIVE';

-- Stage 9C-B: Preemption cooldown — prevents thrashing
ALTER TABLE campaigns
ADD COLUMN IF NOT EXISTS last_preempted_at TIMESTAMPTZ;

-- Protection flag: campaigns with is_protected = TRUE cannot be preempted without approval
-- Stage 9B

ALTER TABLE campaigns
ADD COLUMN IF NOT EXISTS is_protected BOOLEAN DEFAULT FALSE;

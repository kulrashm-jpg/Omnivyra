-- Preemption audit log: records when PREEMPT_LOWER_PRIORITY_CAMPAIGN is executed

CREATE TABLE IF NOT EXISTS campaign_preemption_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  initiator_campaign_id UUID NOT NULL REFERENCES campaigns(id),
  preempted_campaign_id UUID NOT NULL REFERENCES campaigns(id),
  reason TEXT,
  executed_at TIMESTAMPTZ DEFAULT NOW()
);

-- justification added by campaign_preemption_log_justification.sql (Stage 9C-A)

CREATE INDEX IF NOT EXISTS idx_preemption_log_initiator ON campaign_preemption_log(initiator_campaign_id);
CREATE INDEX IF NOT EXISTS idx_preemption_log_preempted ON campaign_preemption_log(preempted_campaign_id);

-- Preemption request queue: REQUEST → APPROVE → EXECUTE flow for protected/CRITICAL targets
-- Stage 9B

CREATE TABLE IF NOT EXISTS campaign_preemption_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  initiator_campaign_id UUID NOT NULL REFERENCES campaigns(id),
  target_campaign_id UUID NOT NULL REFERENCES campaigns(id),
  status VARCHAR(20) DEFAULT 'PENDING',
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ
);

-- Statuses: PENDING | APPROVED | REJECTED | EXECUTED
-- No cascade rules.

CREATE INDEX IF NOT EXISTS idx_preemption_requests_initiator ON campaign_preemption_requests(initiator_campaign_id);
CREATE INDEX IF NOT EXISTS idx_preemption_requests_target ON campaign_preemption_requests(target_campaign_id);
CREATE INDEX IF NOT EXISTS idx_preemption_requests_status ON campaign_preemption_requests(status);

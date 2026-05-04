-- Governance Event Persistence — Authoritative Audit Layer (Stage 10 Phase 3)
-- Structured, queryable governance history. Immutable. Company-scoped.

CREATE TABLE IF NOT EXISTS campaign_governance_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  campaign_id UUID NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  event_status VARCHAR(30) NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  policy_version VARCHAR(20) NOT NULL DEFAULT '1.0.0',
  policy_hash TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_governance_company
  ON campaign_governance_events(company_id);

CREATE INDEX IF NOT EXISTS idx_governance_campaign
  ON campaign_governance_events(campaign_id);

CREATE INDEX IF NOT EXISTS idx_governance_event_type
  ON campaign_governance_events(event_type);

CREATE INDEX IF NOT EXISTS idx_governance_policy_version
  ON campaign_governance_events(policy_version);

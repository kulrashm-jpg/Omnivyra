-- Stage 30 — Governance Disaster Recovery & Snapshot Restoration
-- Snapshot types: FULL | CAMPAIGN | COMPANY

CREATE TABLE IF NOT EXISTS governance_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  snapshot_type VARCHAR(50) NOT NULL CHECK (snapshot_type IN ('FULL', 'CAMPAIGN', 'COMPANY')),
  campaign_id UUID NULL,
  snapshot_data JSONB NOT NULL,
  policy_version VARCHAR(20) NOT NULL,
  policy_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NULL
);

CREATE INDEX IF NOT EXISTS idx_governance_snapshots_company
  ON governance_snapshots(company_id);

CREATE INDEX IF NOT EXISTS idx_governance_snapshots_campaign
  ON governance_snapshots(campaign_id);

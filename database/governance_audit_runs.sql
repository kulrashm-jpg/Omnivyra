-- Stage 28 — Autonomous Governance Audit & Drift Scanner
-- Stores periodic audit snapshots for integrity trending.

CREATE TABLE IF NOT EXISTS governance_audit_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  campaigns_scanned INT NOT NULL,
  drifted_campaigns INT NOT NULL,
  policy_upgrade_campaigns INT NOT NULL,
  average_replay_coverage FLOAT NOT NULL,
  integrity_risk_score INT NOT NULL,
  audit_status VARCHAR(20) NOT NULL CHECK (audit_status IN ('OK', 'WARNING', 'CRITICAL')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_governance_audit_company
  ON governance_audit_runs(company_id);

CREATE INDEX IF NOT EXISTS idx_governance_audit_created
  ON governance_audit_runs(created_at DESC);

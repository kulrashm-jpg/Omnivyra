-- Stage 23 — Governance Policy Versioning.
-- Add policy_version and policy_hash for audit traceability.

ALTER TABLE campaign_governance_events
  ADD COLUMN IF NOT EXISTS policy_version VARCHAR(20) NOT NULL DEFAULT '1.0.0',
  ADD COLUMN IF NOT EXISTS policy_hash TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_governance_policy_version
  ON campaign_governance_events(policy_version);

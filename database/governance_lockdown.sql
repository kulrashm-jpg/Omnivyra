-- Stage 29 — Governance Lockdown Mode
-- Global lock: only 1 row. Enforced in GovernanceLockdownService.

CREATE TABLE IF NOT EXISTS governance_lockdown (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  locked BOOLEAN NOT NULL DEFAULT false,
  reason TEXT,
  triggered_at TIMESTAMPTZ,
  triggered_by UUID,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID
);

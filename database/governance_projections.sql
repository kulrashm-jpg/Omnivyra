-- Stage 32 — Governance Read Model & Performance Isolation Layer
-- Denormalized, read-only materialized projection. Updated on event writes.

CREATE TABLE IF NOT EXISTS governance_projections (
  campaign_id UUID PRIMARY KEY,
  company_id UUID NOT NULL,
  execution_status TEXT NOT NULL,
  blueprint_status TEXT,
  total_events INTEGER DEFAULT 0,
  negotiation_count INTEGER DEFAULT 0,
  rejection_count INTEGER DEFAULT 0,
  freeze_blocks INTEGER DEFAULT 0,
  preemption_count INTEGER DEFAULT 0,
  scheduler_runs INTEGER DEFAULT 0,
  drift_detected BOOLEAN DEFAULT FALSE,
  replay_coverage_ratio NUMERIC DEFAULT 0,
  policy_version TEXT,
  policy_hash TEXT,
  last_event_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  rebuilding_since TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_governance_proj_company
  ON governance_projections(company_id);

-- Phase 2 — User-controlled autonomous listening configuration.
-- Purely additive. Two new tables, no edits to existing tables.
-- Nothing in this migration runs monitoring on its own. The Phase 2 service
-- layer reads/writes these tables to plan, validate, and record monitoring
-- runs — but no worker / scheduler / cron is wired by this migration.

CREATE TABLE IF NOT EXISTS listening_configurations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'manual_only',
  platforms TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  keyword_count INTEGER NOT NULL DEFAULT 0,
  industry_category TEXT NULL,
  industry_volatility TEXT NULL,
  monthly_credit_ceiling INTEGER NOT NULL DEFAULT 0,
  daily_run_ceiling INTEGER NOT NULL DEFAULT 1,
  cooldown_minutes INTEGER NOT NULL DEFAULT 60,
  estimated_monthly_credits_min INTEGER NOT NULL DEFAULT 0,
  estimated_monthly_credits_max INTEGER NOT NULL DEFAULT 0,
  estimated_credits_per_run INTEGER NOT NULL DEFAULT 0,
  next_planned_run_at TIMESTAMPTZ NULL,
  last_run_at TIMESTAMPTZ NULL,
  last_confirmation_at TIMESTAMPTZ NULL,
  confirmed_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  confirmed_estimate_hash TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT listening_configurations_mode_check
    CHECK (mode IN ('manual_only','daily','alternate_days','weekly')),
  CONSTRAINT listening_configurations_volatility_check
    CHECK (industry_volatility IS NULL OR industry_volatility IN ('high','moderate','low')),
  CONSTRAINT listening_configurations_ceilings_check
    CHECK (monthly_credit_ceiling >= 0 AND daily_run_ceiling >= 0 AND cooldown_minutes >= 0),
  CONSTRAINT listening_configurations_estimate_check
    CHECK (estimated_monthly_credits_min >= 0
       AND estimated_monthly_credits_max >= estimated_monthly_credits_min),
  -- One config per org for Phase 2. Per-platform-group configs land later.
  CONSTRAINT listening_configurations_one_per_org UNIQUE (organization_id)
);

CREATE INDEX IF NOT EXISTS idx_listening_configurations_next_run
  ON listening_configurations (next_planned_run_at)
  WHERE mode <> 'manual_only' AND next_planned_run_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS monitoring_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  configuration_id UUID NULL REFERENCES listening_configurations(id) ON DELETE SET NULL,
  planned_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  block_reason TEXT NULL,
  started_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  credit_spent INTEGER NOT NULL DEFAULT 0,
  signal_count INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT monitoring_runs_status_check
    CHECK (status IN ('planned','blocked','skipped','running','completed','failed')),
  CONSTRAINT monitoring_runs_block_reason_check
    CHECK (
      block_reason IS NULL OR block_reason IN (
        'consent_blocked','scope_blocked','budget_blocked',
        'cooldown_blocked','duplicate_run','runaway_protection',
        'mode_manual_only','source_not_ready','capability_disabled'
      )
    ),
  -- Idempotency: a given org cannot have two runs planned for the same
  -- instant. Combined with the orchestration service's per-minute planning
  -- granularity, this physically blocks duplicate scheduling.
  CONSTRAINT monitoring_runs_org_planned_unique UNIQUE (organization_id, planned_at)
);

CREATE INDEX IF NOT EXISTS idx_monitoring_runs_org_status_recent
  ON monitoring_runs (organization_id, status, planned_at DESC);

CREATE INDEX IF NOT EXISTS idx_monitoring_runs_org_completed_at
  ON monitoring_runs (organization_id, completed_at DESC)
  WHERE status = 'completed';

CREATE INDEX IF NOT EXISTS idx_monitoring_runs_org_block_reason
  ON monitoring_runs (organization_id, block_reason)
  WHERE status IN ('blocked','skipped');

CREATE OR REPLACE FUNCTION trg_phase2_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS listening_configurations_set_updated_at ON listening_configurations;
CREATE TRIGGER listening_configurations_set_updated_at
  BEFORE UPDATE ON listening_configurations
  FOR EACH ROW EXECUTE FUNCTION trg_phase2_set_updated_at();

DROP TRIGGER IF EXISTS monitoring_runs_set_updated_at ON monitoring_runs;
CREATE TRIGGER monitoring_runs_set_updated_at
  BEFORE UPDATE ON monitoring_runs
  FOR EACH ROW EXECUTE FUNCTION trg_phase2_set_updated_at();

-- Phase 3 — Controlled listening execution model.
-- Additive only. New tables only. Zero edits to existing tables.
-- Nothing in this migration starts a worker, a cron, or a polling loop.

CREATE TABLE IF NOT EXISTS listening_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  listening_source_id UUID NOT NULL REFERENCES listening_sources(id) ON DELETE CASCADE,
  configuration_id UUID NULL REFERENCES listening_configurations(id) ON DELETE SET NULL,
  monitoring_run_id UUID NULL REFERENCES monitoring_runs(id) ON DELETE SET NULL,
  execution_mode TEXT NOT NULL,
  execution_status TEXT NOT NULL DEFAULT 'planned',
  planned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  queued_at TIMESTAMPTZ NULL,
  started_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  failed_at TIMESTAMPTZ NULL,
  cancelled_at TIMESTAMPTZ NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  estimated_credit_cost INTEGER NOT NULL DEFAULT 0,
  actual_credit_cost INTEGER NOT NULL DEFAULT 0,
  moderation_status TEXT NULL,
  ingestion_stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  signal_stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_metadata JSONB NULL,
  bullmq_job_id TEXT NULL,
  created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT listening_executions_mode_check
    CHECK (execution_mode IN ('ON_DEMAND','SCHEDULED')),
  CONSTRAINT listening_executions_status_check
    CHECK (execution_status IN (
      'planned','queued','running','completed','partial',
      'failed','cancelled','blocked_by_moderation'
    )),
  CONSTRAINT listening_executions_moderation_check
    CHECK (moderation_status IS NULL OR moderation_status IN (
      'pending','approved','flagged','blocked','requires_review'
    ))
);

-- Per-(org, source) anti-overlap: at most ONE non-terminal execution can
-- exist for a given source at a time. Enforced via a partial unique index
-- on the active subset.
CREATE UNIQUE INDEX IF NOT EXISTS uq_listening_executions_active_per_source
  ON listening_executions (listening_source_id)
  WHERE execution_status IN ('planned','queued','running');

CREATE INDEX IF NOT EXISTS idx_listening_executions_org_status_planned
  ON listening_executions (organization_id, execution_status, planned_at DESC);

CREATE INDEX IF NOT EXISTS idx_listening_executions_source_completed
  ON listening_executions (listening_source_id, completed_at DESC)
  WHERE execution_status IN ('completed','partial');

CREATE INDEX IF NOT EXISTS idx_listening_executions_bullmq_jobid
  ON listening_executions (bullmq_job_id)
  WHERE bullmq_job_id IS NOT NULL;

-- Cross-execution dedup: hash of (organization_id, platform, content_hash)
-- so the same Reddit post fetched by two runs does not produce two signals.
-- This is in addition to the canonical_lead_signals unique constraint on
-- (organization_id, source_type, source_id); this table records what we
-- have already SEEN regardless of whether we ended up persisting a signal,
-- so moderation-blocked items still count against future scans.
CREATE TABLE IF NOT EXISTS listening_signal_dedup (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  first_seen_execution_id UUID NULL REFERENCES listening_executions(id) ON DELETE SET NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  seen_count INTEGER NOT NULL DEFAULT 1,
  was_persisted BOOLEAN NOT NULL DEFAULT FALSE,
  was_blocked BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT listening_signal_dedup_unique UNIQUE (organization_id, platform, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_listening_signal_dedup_org_first_seen
  ON listening_signal_dedup (organization_id, first_seen_at DESC);

-- Moderation decisions audit. Blocked content NEVER lands in lead_signals;
-- this table is the only record that we observed and rejected it. Required
-- for compliance / dispute resolution.
CREATE TABLE IF NOT EXISTS moderation_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  listening_execution_id UUID NULL REFERENCES listening_executions(id) ON DELETE SET NULL,
  platform TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  outcome TEXT NOT NULL,
  reasons TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT moderation_decisions_outcome_check
    CHECK (outcome IN ('approved','flagged','blocked','requires_review'))
);

CREATE INDEX IF NOT EXISTS idx_moderation_decisions_org_created
  ON moderation_decisions (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_moderation_decisions_org_outcome
  ON moderation_decisions (organization_id, outcome);

CREATE OR REPLACE FUNCTION trg_phase3_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS listening_executions_set_updated_at ON listening_executions;
CREATE TRIGGER listening_executions_set_updated_at
  BEFORE UPDATE ON listening_executions
  FOR EACH ROW EXECUTE FUNCTION trg_phase3_set_updated_at();

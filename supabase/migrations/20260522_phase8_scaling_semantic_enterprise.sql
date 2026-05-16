-- Phase 8 — Production scaling, semantic activation, enterprise rollout.
-- Fully additive. No edits to existing tables. Zero workers / cron entries
-- added by this migration; new BullMQ queue is provisioned in app code.

-- ---------------------------------------------------------------------------
-- EXECUTION PARTITIONS + LEASES
-- ---------------------------------------------------------------------------
-- One row per (org, partition_key). At any instant at most one worker
-- holds the lease (lease_expires_at > now() AND owner_worker_id is set).
-- The partial UNIQUE index on (organization_id, partition_key) WHERE
-- lease_expires_at IS NULL OR lease_expires_at > now() is approximated
-- via a simpler UNIQUE + service-level atomic upsert; the service refuses
-- to grant a new lease when an unexpired one exists.

CREATE TABLE IF NOT EXISTS execution_partitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  partition_key TEXT NOT NULL,
  owner_worker_id TEXT NULL,
  lease_acquired_at TIMESTAMPTZ NULL,
  lease_expires_at TIMESTAMPTZ NULL,
  heartbeat_at TIMESTAMPTZ NULL,
  status TEXT NOT NULL DEFAULT 'idle',
  released_at TIMESTAMPTZ NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT partition_status_check CHECK (status IN ('idle','leased','expired','released','quarantined')),
  CONSTRAINT partition_unique UNIQUE (organization_id, partition_key)
);

CREATE INDEX IF NOT EXISTS idx_partitions_org_status_recent
  ON execution_partitions (organization_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_partitions_active_lease
  ON execution_partitions (lease_expires_at)
  WHERE status = 'leased' AND lease_expires_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- INGESTION THROUGHPUT
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ingestion_throughput_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  -- For 'platform' scope the bucket carries the platform name (e.g. 'reddit'),
  -- for 'org' scope it carries the literal 'org'.
  bucket TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  consumed_count INTEGER NOT NULL DEFAULT 0,
  consumed_credits INTEGER NOT NULL DEFAULT 0,
  cap_count INTEGER NULL,
  cap_credits INTEGER NULL,
  burst_count INTEGER NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT throughput_scope_check CHECK (scope IN ('org','platform','source','connector')),
  CONSTRAINT throughput_window_check CHECK (window_end > window_start),
  CONSTRAINT throughput_unique UNIQUE (organization_id, scope, bucket, window_start)
);

CREATE INDEX IF NOT EXISTS idx_throughput_org_scope_recent
  ON ingestion_throughput_state (organization_id, scope, bucket, window_end DESC);

-- ---------------------------------------------------------------------------
-- SEMANTIC INDEXING JOBS
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS semantic_indexing_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL,
  source_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'queued',
  embedding_provider TEXT NOT NULL DEFAULT 'deterministic_hash_v1',
  embedding_dim INTEGER NOT NULL DEFAULT 32,
  chunks_indexed INTEGER NOT NULL DEFAULT 0,
  chunks_failed INTEGER NOT NULL DEFAULT 0,
  cost_units INTEGER NOT NULL DEFAULT 0,
  failure_reason TEXT NULL,
  requested_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT semantic_job_status_check
    CHECK (status IN ('queued','running','complete','failed','cancelled')),
  CONSTRAINT semantic_job_source_kind_check
    CHECK (source_kind IN (
      'opportunity_feed_item','opportunity_note','signal_intent_cluster',
      'listening_execution','graph_node','escalation','investigation_workspace_item'
    )),
  CONSTRAINT semantic_job_dim_bounds CHECK (embedding_dim BETWEEN 8 AND 2048)
);

CREATE INDEX IF NOT EXISTS idx_semantic_jobs_org_recent
  ON semantic_indexing_jobs (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_semantic_jobs_org_status
  ON semantic_indexing_jobs (organization_id, status, created_at DESC);

-- ---------------------------------------------------------------------------
-- COST GOVERNANCE
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cost_budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  monthly_soft_ceiling INTEGER NOT NULL DEFAULT 0,
  monthly_hard_ceiling INTEGER NOT NULL DEFAULT 0,
  alert_threshold_percent INTEGER NOT NULL DEFAULT 80,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cost_budget_category_check
    CHECK (category IN ('embedding','execution','connector','realtime','storage','semantic_indexing')),
  CONSTRAINT cost_budget_ceilings_check
    CHECK (monthly_soft_ceiling >= 0 AND monthly_hard_ceiling >= monthly_soft_ceiling),
  CONSTRAINT cost_budget_threshold_check
    CHECK (alert_threshold_percent BETWEEN 1 AND 100),
  CONSTRAINT cost_budget_unique UNIQUE (organization_id, category)
);

CREATE INDEX IF NOT EXISTS idx_cost_budgets_org_enabled
  ON cost_budgets (organization_id, category)
  WHERE enabled = TRUE;

CREATE TABLE IF NOT EXISTS cost_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  units INTEGER NOT NULL,
  attribution_kind TEXT NULL,
  attribution_ref TEXT NULL,
  decision TEXT NOT NULL DEFAULT 'allowed',
  reasons TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cost_event_category_check
    CHECK (category IN ('embedding','execution','connector','realtime','storage','semantic_indexing')),
  CONSTRAINT cost_event_decision_check
    CHECK (decision IN ('allowed','warned','denied','overage_approved'))
);

CREATE INDEX IF NOT EXISTS idx_cost_events_org_recent
  ON cost_events (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cost_events_org_category_recent
  ON cost_events (organization_id, category, created_at DESC);

-- ---------------------------------------------------------------------------
-- SLA + RELIABILITY
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sla_breaches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  sla_kind TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warn',
  observed_value NUMERIC NOT NULL,
  threshold_value NUMERIC NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  rationale TEXT NULL,
  acknowledged_at TIMESTAMPTZ NULL,
  acknowledged_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sla_kind_check
    CHECK (sla_kind IN (
      'execution_latency','projection_latency','moderation_latency',
      'replay_recovery_latency','realtime_delivery_latency','connector_reliability'
    )),
  CONSTRAINT sla_severity_check CHECK (severity IN ('warn','breach','critical'))
);

CREATE INDEX IF NOT EXISTS idx_sla_breaches_org_recent
  ON sla_breaches (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sla_breaches_org_kind
  ON sla_breaches (organization_id, sla_kind, created_at DESC);

-- ---------------------------------------------------------------------------
-- ENTERPRISE RBAC
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS intelligence_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  capabilities TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  sso_external_id TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT intelligence_role_unique UNIQUE (organization_id, role_key)
);

CREATE INDEX IF NOT EXISTS idx_intelligence_roles_org_key
  ON intelligence_roles (organization_id, role_key);

CREATE TABLE IF NOT EXISTS intelligence_role_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES intelligence_roles(id) ON DELETE CASCADE,
  assigned_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NULL,
  revoked_at TIMESTAMPTZ NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT intelligence_role_assignment_unique_active UNIQUE (organization_id, user_id, role_id, revoked_at)
);

CREATE INDEX IF NOT EXISTS idx_intelligence_role_assignments_user_active
  ON intelligence_role_assignments (organization_id, user_id)
  WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- FEATURE FLAGS + ROLLOUT
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS feature_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  flag_key TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  rollout_cohort TEXT NULL,
  rollout_percent INTEGER NULL,
  rationale TEXT NULL,
  activated_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  activated_at TIMESTAMPTZ NULL,
  reverted_at TIMESTAMPTZ NULL,
  reverted_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT feature_flag_percent_bounds CHECK (rollout_percent IS NULL OR rollout_percent BETWEEN 0 AND 100),
  CONSTRAINT feature_flag_unique UNIQUE (organization_id, flag_key)
);

CREATE INDEX IF NOT EXISTS idx_feature_flags_org_enabled
  ON feature_flags (organization_id, flag_key)
  WHERE enabled = TRUE;

-- ---------------------------------------------------------------------------
-- OPERATOR ACTIONS (audit log)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS operator_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  action_kind TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_ref TEXT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  rationale TEXT NULL,
  actor_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT operator_action_kind_check
    CHECK (action_kind IN (
      'pause','resume','throttle','unthrottle','recover','rollback',
      'flag_activated','flag_reverted','budget_overage_approved'
    ))
);

CREATE INDEX IF NOT EXISTS idx_operator_actions_org_recent
  ON operator_actions (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_operator_actions_org_target
  ON operator_actions (organization_id, target_kind, target_ref);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION trg_phase8_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS partitions_set_updated_at ON execution_partitions;
CREATE TRIGGER partitions_set_updated_at
  BEFORE UPDATE ON execution_partitions
  FOR EACH ROW EXECUTE FUNCTION trg_phase8_set_updated_at();

DROP TRIGGER IF EXISTS throughput_set_updated_at ON ingestion_throughput_state;
CREATE TRIGGER throughput_set_updated_at
  BEFORE UPDATE ON ingestion_throughput_state
  FOR EACH ROW EXECUTE FUNCTION trg_phase8_set_updated_at();

DROP TRIGGER IF EXISTS semantic_jobs_set_updated_at ON semantic_indexing_jobs;
CREATE TRIGGER semantic_jobs_set_updated_at
  BEFORE UPDATE ON semantic_indexing_jobs
  FOR EACH ROW EXECUTE FUNCTION trg_phase8_set_updated_at();

DROP TRIGGER IF EXISTS cost_budgets_set_updated_at ON cost_budgets;
CREATE TRIGGER cost_budgets_set_updated_at
  BEFORE UPDATE ON cost_budgets
  FOR EACH ROW EXECUTE FUNCTION trg_phase8_set_updated_at();

DROP TRIGGER IF EXISTS intelligence_roles_set_updated_at ON intelligence_roles;
CREATE TRIGGER intelligence_roles_set_updated_at
  BEFORE UPDATE ON intelligence_roles
  FOR EACH ROW EXECUTE FUNCTION trg_phase8_set_updated_at();

DROP TRIGGER IF EXISTS feature_flags_set_updated_at ON feature_flags;
CREATE TRIGGER feature_flags_set_updated_at
  BEFORE UPDATE ON feature_flags
  FOR EACH ROW EXECUTE FUNCTION trg_phase8_set_updated_at();

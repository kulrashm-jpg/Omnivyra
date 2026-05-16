-- Phase 7 — Enterprise governance, retention, audit export, DLQ replay,
-- search foundations, semantic retrieval, investigation workspaces,
-- operational resilience. Fully additive — no edits to existing tables.

-- ---------------------------------------------------------------------------
-- GOVERNANCE POLICIES (versioned, immutable history per version)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS intelligence_governance_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  policy_key TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft',
  -- restricted_sources, blocked_keywords, connector_allowlist,
  -- escalation_rules, moderation_thresholds, retention_overrides,
  -- replay_permissions, export_permissions, source_execution_ceilings
  body JSONB NOT NULL DEFAULT '{}'::jsonb,
  rationale TEXT NULL,
  activated_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  activated_at TIMESTAMPTZ NULL,
  superseded_at TIMESTAMPTZ NULL,
  superseded_by_version INTEGER NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT governance_policy_status_check
    CHECK (status IN ('draft','active','superseded','archived')),
  CONSTRAINT governance_policy_key_check
    CHECK (policy_key IN (
      'sources','keywords','connectors','escalations','moderation',
      'retention','replay','export','source_execution'
    )),
  CONSTRAINT governance_policy_version_positive CHECK (version >= 1),
  CONSTRAINT governance_policy_unique_version UNIQUE (organization_id, policy_key, version)
);

-- At most one ACTIVE version per (org, policy_key) at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_governance_policy_active
  ON intelligence_governance_policies (organization_id, policy_key)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_governance_policies_org_key_recent
  ON intelligence_governance_policies (organization_id, policy_key, version DESC);

-- Append-only enforcement on policy rows: once a version exists, only the
-- transition draft→active or active→superseded/archived is permitted on
-- the same row. Other column changes are blocked.
CREATE OR REPLACE FUNCTION trg_governance_policy_protect_update()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.organization_id IS DISTINCT FROM NEW.organization_id
     OR OLD.policy_key IS DISTINCT FROM NEW.policy_key
     OR OLD.version IS DISTINCT FROM NEW.version
     OR OLD.body IS DISTINCT FROM NEW.body
     OR OLD.created_at IS DISTINCT FROM NEW.created_at
     OR OLD.created_by IS DISTINCT FROM NEW.created_by THEN
    RAISE EXCEPTION 'governance policy rows are immutable except for status / activation fields';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS governance_policy_protect_update ON intelligence_governance_policies;
CREATE TRIGGER governance_policy_protect_update
  BEFORE UPDATE ON intelligence_governance_policies
  FOR EACH ROW EXECUTE FUNCTION trg_governance_policy_protect_update();

-- Governance enforcement audit log — every policy decision (allowed /
-- denied) recorded for compliance review.
CREATE TABLE IF NOT EXISTS governance_enforcement_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  policy_key TEXT NOT NULL,
  policy_version INTEGER NULL,
  action TEXT NOT NULL,
  decision TEXT NOT NULL,
  reasons TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT governance_event_decision_check
    CHECK (decision IN ('allowed','denied','allowed_with_warning'))
);

CREATE INDEX IF NOT EXISTS idx_governance_events_org_recent
  ON governance_enforcement_events (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_governance_events_org_key
  ON governance_enforcement_events (organization_id, policy_key, created_at DESC);

-- ---------------------------------------------------------------------------
-- RETENTION
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS retention_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  target_kind TEXT NOT NULL,
  retain_days INTEGER NOT NULL,
  archival_mode TEXT NOT NULL DEFAULT 'soft_delete',
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT retention_target_check
    CHECK (target_kind IN (
      'raw_ingested_content','moderation_decisions','opportunity_feed_items',
      'lifecycle_history','observability_traces','alerts',
      'projection_sync_state','graph_edges','listening_executions','listening_signal_dedup'
    )),
  CONSTRAINT retention_days_bounds CHECK (retain_days BETWEEN 7 AND 3650),
  CONSTRAINT retention_archival_check CHECK (archival_mode IN ('soft_delete','hard_delete')),
  CONSTRAINT retention_unique UNIQUE (organization_id, target_kind)
);

CREATE INDEX IF NOT EXISTS idx_retention_org_enabled
  ON retention_policies (organization_id)
  WHERE enabled = TRUE;

CREATE TABLE IF NOT EXISTS retention_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  retention_policy_id UUID NOT NULL REFERENCES retention_policies(id) ON DELETE CASCADE,
  execution_mode TEXT NOT NULL,
  rows_scanned INTEGER NOT NULL DEFAULT 0,
  rows_affected INTEGER NOT NULL DEFAULT 0,
  cutoff_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  detail TEXT NULL,
  initiated_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT retention_exec_mode_check CHECK (execution_mode IN ('dry_run','execute')),
  CONSTRAINT retention_exec_status_check CHECK (status IN ('completed','partial','failed'))
);

CREATE INDEX IF NOT EXISTS idx_retention_executions_org_recent
  ON retention_executions (organization_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- AUDIT EXPORTS
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit_export_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  export_type TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT 'json',
  status TEXT NOT NULL DEFAULT 'queued',
  filter_criteria JSONB NOT NULL DEFAULT '{}'::jsonb,
  row_count INTEGER NULL,
  byte_size INTEGER NULL,
  storage_ref TEXT NULL,
  payload_inline JSONB NULL,
  failure_reason TEXT NULL,
  requested_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT export_type_check
    CHECK (export_type IN (
      'lifecycle_history','moderation_decisions','escalations',
      'execution_traces','identity_actions','governance_history','source_health_history'
    )),
  CONSTRAINT export_format_check CHECK (format IN ('json','csv')),
  CONSTRAINT export_status_check CHECK (status IN ('queued','processing','complete','failed','cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_audit_export_org_recent
  ON audit_export_jobs (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_export_org_status
  ON audit_export_jobs (organization_id, status, created_at DESC);

-- ---------------------------------------------------------------------------
-- DLQ + REPLAY OPERATIONS
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS replay_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  target_kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested',
  requested_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  batch_size INTEGER NOT NULL DEFAULT 0,
  preview_summary JSONB NULL,
  result_summary JSONB NULL,
  approved_at TIMESTAMPTZ NULL,
  approved_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  executed_at TIMESTAMPTZ NULL,
  executed_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  failure_reason TEXT NULL,
  requested_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT replay_target_check
    CHECK (target_kind IN ('projection','execution_failure','moderation_block','alert')),
  CONSTRAINT replay_status_check
    CHECK (status IN ('requested','previewed','approved','executing','complete','failed','cancelled')),
  CONSTRAINT replay_batch_size_bounds CHECK (batch_size BETWEEN 0 AND 500)
);

CREATE INDEX IF NOT EXISTS idx_replay_ops_org_status
  ON replay_operations (organization_id, status, created_at DESC);

-- ---------------------------------------------------------------------------
-- SEMANTIC RETRIEVAL FOUNDATION (embedding-ready; no AI today)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS semantic_index_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL,
  source_id UUID NOT NULL,
  chunk_index INTEGER NOT NULL DEFAULT 0,
  content_excerpt TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  -- Embedding placeholder. Phase 7 ships the schema only — no embedding
  -- writer exists yet. A later phase will populate this via an explicit
  -- (user-triggered) re-index operation.
  embedding_provider TEXT NULL,
  embedding_dim INTEGER NULL,
  embedding_vector JSONB NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT semantic_source_kind_check
    CHECK (source_kind IN (
      'opportunity_feed_item','opportunity_note','signal_intent_cluster',
      'listening_execution','graph_node','escalation','investigation_workspace_item'
    )),
  CONSTRAINT semantic_excerpt_length CHECK (length(content_excerpt) BETWEEN 10 AND 8000),
  CONSTRAINT semantic_index_unique UNIQUE (organization_id, source_kind, source_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_semantic_index_org_source_kind
  ON semantic_index_entries (organization_id, source_kind, indexed_at DESC);

CREATE INDEX IF NOT EXISTS idx_semantic_index_org_hash
  ON semantic_index_entries (organization_id, content_hash);

-- ---------------------------------------------------------------------------
-- INVESTIGATION WORKSPACES
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS investigation_workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  closed_at TIMESTAMPTZ NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT investigation_status_check CHECK (status IN ('open','in_progress','resolved','archived')),
  CONSTRAINT investigation_title_length CHECK (length(title) BETWEEN 1 AND 200)
);

CREATE INDEX IF NOT EXISTS idx_investigation_org_status_recent
  ON investigation_workspaces (organization_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS investigation_workspace_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES investigation_workspaces(id) ON DELETE CASCADE,
  item_kind TEXT NOT NULL,
  item_ref TEXT NOT NULL,
  body TEXT NULL,
  pinned BOOLEAN NOT NULL DEFAULT FALSE,
  added_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT investigation_item_kind_check
    CHECK (item_kind IN (
      'opportunity','cluster','source','execution','escalation','graph_snapshot','note','replay_link'
    ))
);

CREATE INDEX IF NOT EXISTS idx_investigation_items_workspace
  ON investigation_workspace_items (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_investigation_items_org_kind
  ON investigation_workspace_items (organization_id, item_kind);

-- Bound workspace size — application enforces hard limit; this partial
-- index helps quickly count items per workspace.
CREATE INDEX IF NOT EXISTS idx_investigation_items_workspace_pinned
  ON investigation_workspace_items (workspace_id)
  WHERE pinned = TRUE;

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION trg_phase7_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS retention_policies_set_updated_at ON retention_policies;
CREATE TRIGGER retention_policies_set_updated_at
  BEFORE UPDATE ON retention_policies
  FOR EACH ROW EXECUTE FUNCTION trg_phase7_set_updated_at();

DROP TRIGGER IF EXISTS investigations_set_updated_at ON investigation_workspaces;
CREATE TRIGGER investigations_set_updated_at
  BEFORE UPDATE ON investigation_workspaces
  FOR EACH ROW EXECUTE FUNCTION trg_phase7_set_updated_at();

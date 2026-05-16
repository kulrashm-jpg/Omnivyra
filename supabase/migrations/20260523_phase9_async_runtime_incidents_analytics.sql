-- Phase 9 — Async semantic runtime, distributed replay, analytics warehouse,
-- incident management, analyst productivity, executive reporting, multi-region
-- readiness. Fully additive. No edits to existing tables.

-- ---------------------------------------------------------------------------
-- SEMANTIC INDEXING PARTITIONS (per-job work shards)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS semantic_indexing_partitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  semantic_indexing_job_id UUID NOT NULL REFERENCES semantic_indexing_jobs(id) ON DELETE CASCADE,
  partition_index INTEGER NOT NULL,
  source_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts_made INTEGER NOT NULL DEFAULT 0,
  worker_id TEXT NULL,
  chunks_indexed INTEGER NOT NULL DEFAULT 0,
  chunks_failed INTEGER NOT NULL DEFAULT 0,
  cost_units INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  failure_reason TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT semantic_partition_status_check
    CHECK (status IN ('queued','running','complete','failed','cancelled')),
  CONSTRAINT semantic_partition_attempts_bound CHECK (attempts_made BETWEEN 0 AND 5),
  CONSTRAINT semantic_partition_unique UNIQUE (semantic_indexing_job_id, partition_index)
);

CREATE INDEX IF NOT EXISTS idx_semantic_partitions_org_status
  ON semantic_indexing_partitions (organization_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_semantic_partitions_job
  ON semantic_indexing_partitions (semantic_indexing_job_id, partition_index);

-- ---------------------------------------------------------------------------
-- SEMANTIC RETRIEVAL EXPLANATIONS (cache + audit)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS semantic_retrieval_explanations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  query_hash TEXT NOT NULL,
  query_text TEXT NOT NULL,
  retrieval_mode TEXT NOT NULL DEFAULT 'hybrid',
  hits JSONB NOT NULL DEFAULT '[]'::jsonb,
  composition JSONB NOT NULL DEFAULT '{}'::jsonb,
  requested_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT semantic_retrieval_mode_check
    CHECK (retrieval_mode IN ('lexical_only','semantic_only','hybrid'))
);

CREATE INDEX IF NOT EXISTS idx_semantic_retrieval_org_recent
  ON semantic_retrieval_explanations (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_semantic_retrieval_org_query
  ON semantic_retrieval_explanations (organization_id, query_hash);

-- ---------------------------------------------------------------------------
-- REPLAY PARTITIONS + CHECKPOINTS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS replay_partitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  replay_operation_id UUID NOT NULL REFERENCES replay_operations(id) ON DELETE CASCADE,
  partition_index INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  worker_id TEXT NULL,
  item_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  checkpoint JSONB NOT NULL DEFAULT '{}'::jsonb,
  processed_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  attempts_made INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  failure_reason TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT replay_partition_status_check
    CHECK (status IN ('queued','running','complete','failed','cancelled')),
  CONSTRAINT replay_partition_attempts_bound CHECK (attempts_made BETWEEN 0 AND 5),
  CONSTRAINT replay_partition_unique UNIQUE (replay_operation_id, partition_index)
);

CREATE INDEX IF NOT EXISTS idx_replay_partitions_org_status
  ON replay_partitions (organization_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_replay_partitions_op
  ON replay_partitions (replay_operation_id, partition_index);

-- ---------------------------------------------------------------------------
-- ANALYTICS WAREHOUSE
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS analytics_warehouse_facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  fact_kind TEXT NOT NULL,
  bucket_start TIMESTAMPTZ NOT NULL,
  bucket_end TIMESTAMPTZ NOT NULL,
  dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,
  measures JSONB NOT NULL DEFAULT '{}'::jsonb,
  materialization_id UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT warehouse_fact_kind_check
    CHECK (fact_kind IN (
      'opportunity_daily','source_roi_daily','escalation_daily',
      'execution_daily','moderation_daily','cost_daily','sla_daily'
    )),
  CONSTRAINT warehouse_fact_window_check CHECK (bucket_end > bucket_start),
  CONSTRAINT warehouse_fact_unique UNIQUE (organization_id, fact_kind, bucket_start, dimensions)
);

CREATE INDEX IF NOT EXISTS idx_warehouse_facts_org_kind_bucket
  ON analytics_warehouse_facts (organization_id, fact_kind, bucket_start DESC);

CREATE TABLE IF NOT EXISTS analytics_materializations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  fact_kind TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  rows_written INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'complete',
  detail TEXT NULL,
  initiated_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT analytics_materialization_kind_check
    CHECK (fact_kind IN (
      'opportunity_daily','source_roi_daily','escalation_daily',
      'execution_daily','moderation_daily','cost_daily','sla_daily'
    )),
  CONSTRAINT analytics_materialization_status_check
    CHECK (status IN ('complete','partial','failed'))
);

CREATE INDEX IF NOT EXISTS idx_analytics_materializations_org_kind
  ON analytics_materializations (organization_id, fact_kind, created_at DESC);

-- ---------------------------------------------------------------------------
-- INCIDENTS + TIMELINE
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS intelligence_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NULL,
  severity TEXT NOT NULL DEFAULT 'sev3',
  status TEXT NOT NULL DEFAULT 'open',
  category TEXT NOT NULL,
  owner_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  linked_escalation_id UUID NULL REFERENCES escalations(id) ON DELETE SET NULL,
  linked_replay_id UUID NULL REFERENCES replay_operations(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolved_at TIMESTAMPTZ NULL,
  resolved_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT incident_severity_check CHECK (severity IN ('sev1','sev2','sev3','sev4')),
  CONSTRAINT incident_status_check
    CHECK (status IN ('open','triaging','mitigating','resolved','postmortem','closed')),
  CONSTRAINT incident_category_check
    CHECK (category IN (
      'execution_failure','semantic_indexing_failure','replay_failure',
      'projection_drift','moderation_outage','cost_breach',
      'sla_breach','connector_outage','governance_violation','other'
    )),
  CONSTRAINT incident_title_length CHECK (length(title) BETWEEN 1 AND 200)
);

CREATE INDEX IF NOT EXISTS idx_incidents_org_status
  ON intelligence_incidents (organization_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_incidents_org_severity
  ON intelligence_incidents (organization_id, severity, created_at DESC);

CREATE TABLE IF NOT EXISTS incident_timeline_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  incident_id UUID NOT NULL REFERENCES intelligence_incidents(id) ON DELETE CASCADE,
  entry_kind TEXT NOT NULL,
  body TEXT NULL,
  actor_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT incident_timeline_kind_check
    CHECK (entry_kind IN (
      'created','status_changed','severity_changed','owner_changed',
      'note','mitigation_applied','replay_linked','escalation_linked',
      'resolved','reopened'
    ))
);

CREATE INDEX IF NOT EXISTS idx_incident_timeline_incident_recent
  ON incident_timeline_entries (incident_id, created_at DESC);

-- Append-only enforcement on the timeline: protects audit trail.
CREATE OR REPLACE FUNCTION trg_incident_timeline_block_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    RAISE EXCEPTION 'incident_timeline_entries is append-only';
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS incident_timeline_block_update ON incident_timeline_entries;
CREATE TRIGGER incident_timeline_block_update
  BEFORE UPDATE ON incident_timeline_entries
  FOR EACH ROW EXECUTE FUNCTION trg_incident_timeline_block_mutation();
DROP TRIGGER IF EXISTS incident_timeline_block_delete ON incident_timeline_entries;
CREATE TRIGGER incident_timeline_block_delete
  BEFORE DELETE ON incident_timeline_entries
  FOR EACH ROW EXECUTE FUNCTION trg_incident_timeline_block_mutation();

-- ---------------------------------------------------------------------------
-- ANALYST PRODUCTIVITY
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS saved_intelligence_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  view_kind TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NULL,
  filter_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  owner_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  shared BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT saved_view_kind_check
    CHECK (view_kind IN ('search','filter','bookmark','collection','investigation_template')),
  CONSTRAINT saved_view_name_length CHECK (length(name) BETWEEN 1 AND 120)
);

CREATE INDEX IF NOT EXISTS idx_saved_views_org_kind
  ON saved_intelligence_views (organization_id, view_kind, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_saved_views_owner
  ON saved_intelligence_views (organization_id, owner_user_id);

CREATE TABLE IF NOT EXISTS analyst_collection_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  collection_id UUID NOT NULL REFERENCES saved_intelligence_views(id) ON DELETE CASCADE,
  item_kind TEXT NOT NULL,
  item_ref TEXT NOT NULL,
  body TEXT NULL,
  added_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT collection_item_kind_check
    CHECK (item_kind IN (
      'opportunity','cluster','source','execution','escalation',
      'incident','note','snapshot','external_link'
    ))
);

CREATE INDEX IF NOT EXISTS idx_collection_items_collection_recent
  ON analyst_collection_items (collection_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- REPORTING
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS report_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  report_kind TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NULL,
  filter_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  schedule_cron TEXT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  owner_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT report_kind_check
    CHECK (report_kind IN (
      'opportunity_trends','source_roi','escalation_summary',
      'competitor_intel','operational_health','sla_report','governance_audit'
    )),
  CONSTRAINT report_name_length CHECK (length(name) BETWEEN 1 AND 120)
);

CREATE INDEX IF NOT EXISTS idx_report_definitions_org_enabled
  ON report_definitions (organization_id, report_kind)
  WHERE enabled = TRUE;

CREATE TABLE IF NOT EXISTS report_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  report_definition_id UUID NULL REFERENCES report_definitions(id) ON DELETE SET NULL,
  report_kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  payload_inline JSONB NULL,
  filter_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  row_count INTEGER NULL,
  byte_size INTEGER NULL,
  failure_reason TEXT NULL,
  requested_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT report_execution_status_check
    CHECK (status IN ('queued','processing','complete','failed','cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_report_executions_org_recent
  ON report_executions (organization_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- REGION ROUTING (multi-region readiness)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS region_routing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  primary_region TEXT NOT NULL DEFAULT 'us-east-1',
  failover_region TEXT NULL,
  partition_routing JSONB NOT NULL DEFAULT '{}'::jsonb,
  failover_strategy TEXT NOT NULL DEFAULT 'manual',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT region_failover_strategy_check
    CHECK (failover_strategy IN ('manual','operator_approved')),
  CONSTRAINT region_routing_unique UNIQUE (organization_id)
);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_phase9_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS semantic_partitions_set_updated_at ON semantic_indexing_partitions;
CREATE TRIGGER semantic_partitions_set_updated_at BEFORE UPDATE ON semantic_indexing_partitions
  FOR EACH ROW EXECUTE FUNCTION trg_phase9_set_updated_at();

DROP TRIGGER IF EXISTS replay_partitions_set_updated_at ON replay_partitions;
CREATE TRIGGER replay_partitions_set_updated_at BEFORE UPDATE ON replay_partitions
  FOR EACH ROW EXECUTE FUNCTION trg_phase9_set_updated_at();

DROP TRIGGER IF EXISTS incidents_set_updated_at ON intelligence_incidents;
CREATE TRIGGER incidents_set_updated_at BEFORE UPDATE ON intelligence_incidents
  FOR EACH ROW EXECUTE FUNCTION trg_phase9_set_updated_at();

DROP TRIGGER IF EXISTS saved_views_set_updated_at ON saved_intelligence_views;
CREATE TRIGGER saved_views_set_updated_at BEFORE UPDATE ON saved_intelligence_views
  FOR EACH ROW EXECUTE FUNCTION trg_phase9_set_updated_at();

DROP TRIGGER IF EXISTS report_definitions_set_updated_at ON report_definitions;
CREATE TRIGGER report_definitions_set_updated_at BEFORE UPDATE ON report_definitions
  FOR EACH ROW EXECUTE FUNCTION trg_phase9_set_updated_at();

DROP TRIGGER IF EXISTS region_routing_set_updated_at ON region_routing;
CREATE TRIGGER region_routing_set_updated_at BEFORE UPDATE ON region_routing
  FOR EACH ROW EXECUTE FUNCTION trg_phase9_set_updated_at();

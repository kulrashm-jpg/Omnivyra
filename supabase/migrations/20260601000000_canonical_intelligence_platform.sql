-- Canonical Intelligence Platform schema (Phase 7).
--
-- Single migration that materializes every persistent store in the canonical
-- intelligence layer. Each table:
--   - is tenant-scoped via `tenant_id`
--   - carries `observed_at` / `created_at` for lifecycle / retention
--   - has the canonical indexes its store-side query patterns require
--   - is documented inline so operators can reason about it without code
--
-- This migration replaces every prior in-memory default with durable state.

-- =============================================================================
-- 1. Tenant policy
-- =============================================================================
CREATE TABLE IF NOT EXISTS tenant_policy (
  tenant_id text PRIMARY KEY,
  display_name text NOT NULL,
  plan_tier text NOT NULL CHECK (plan_tier IN ('starter', 'standard', 'professional', 'enterprise')),
  policy_revision text NOT NULL,
  providers jsonb NOT NULL,        -- TenantProviderPolicy
  scan_budget jsonb NOT NULL,      -- TenantScanBudgetPolicy
  retention jsonb NOT NULL,        -- TenantRetentionPolicy
  benchmark jsonb NOT NULL,        -- TenantBenchmarkPolicy
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by jsonb NOT NULL        -- { id, kind, label }
);

CREATE INDEX IF NOT EXISTS idx_tenant_policy_plan_tier ON tenant_policy(plan_tier);

-- =============================================================================
-- 2. Audit log (append-only)
-- =============================================================================
CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  actor jsonb NOT NULL,            -- { id, kind, label }
  correlation_id text,
  kind text NOT NULL CHECK (kind IN (
    'provider_call', 'report_generated', 'recommendation_state_change',
    'benchmark_dataset_change', 'manual_override', 'tenant_policy_change',
    'scan_executed', 'scan_cancelled', 'scan_failed', 'collaboration_event'
  )),
  payload jsonb NOT NULL
);

-- audit_log is append-only by convention; revoke UPDATE/DELETE in production.
CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_time ON audit_log(tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_kind_time ON audit_log(tenant_id, kind, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_correlation ON audit_log(correlation_id) WHERE correlation_id IS NOT NULL;

-- =============================================================================
-- 3. Manual overrides
-- =============================================================================
CREATE TABLE IF NOT EXISTS manual_overrides (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  company_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN (
    'benchmark_band', 'vertical_classification', 'company_size_band',
    'provider_exclusion', 'evidence_suppression', 'recommendation_dismissal',
    'analyst_note'
  )),
  target jsonb NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by jsonb NOT NULL,
  reversed_at timestamptz,
  reversed_by jsonb
);

CREATE INDEX IF NOT EXISTS idx_manual_overrides_tenant_company ON manual_overrides(tenant_id, company_id);
CREATE INDEX IF NOT EXISTS idx_manual_overrides_active ON manual_overrides(tenant_id, company_id) WHERE reversed_at IS NULL;

-- =============================================================================
-- 4. Collaboration
-- =============================================================================
CREATE TABLE IF NOT EXISTS collaboration_annotations (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  company_id text NOT NULL,
  anchor jsonb NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by jsonb NOT NULL,
  resolved_at timestamptz,
  resolved_by jsonb
);
CREATE INDEX IF NOT EXISTS idx_annotations_tenant_company ON collaboration_annotations(tenant_id, company_id);

CREATE TABLE IF NOT EXISTS collaboration_assignments (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  company_id text NOT NULL,
  action_id text NOT NULL,
  assigned_to jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('open', 'in_progress', 'completed', 'cancelled')),
  due_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_assignments_tenant_company ON collaboration_assignments(tenant_id, company_id);
CREATE INDEX IF NOT EXISTS idx_assignments_status ON collaboration_assignments(tenant_id, status);

CREATE TABLE IF NOT EXISTS collaboration_pinned_findings (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  company_id text NOT NULL,
  finding_kind text NOT NULL CHECK (finding_kind IN ('risk', 'opportunity', 'win', 'note')),
  title text NOT NULL,
  body text NOT NULL,
  pinned_at timestamptz NOT NULL DEFAULT now(),
  pinned_by jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pinned_findings_tenant_company ON collaboration_pinned_findings(tenant_id, company_id);

CREATE TABLE IF NOT EXISTS collaboration_recommendation_status (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  company_id text NOT NULL,
  action_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('accepted', 'in_progress', 'completed', 'rejected', 'deferred')),
  notes text,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rec_status_tenant_company ON collaboration_recommendation_status(tenant_id, company_id);
CREATE INDEX IF NOT EXISTS idx_rec_status_action ON collaboration_recommendation_status(tenant_id, action_id, changed_at DESC);

-- =============================================================================
-- 5. Scan queue
-- =============================================================================
CREATE TABLE IF NOT EXISTS scan_queue (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  company_id text NOT NULL,
  scan_profile text NOT NULL CHECK (scan_profile IN ('lightweight', 'standard', 'deep', 'manual_refresh', 'delta_only')),
  origin text NOT NULL CHECK (origin IN ('manual', 'scheduled', 'partial_rerun', 'provider_rerun', 'delta_only')),
  priority int NOT NULL DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
  scoped_providers jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN (
    'queued', 'running', 'completed', 'cancelled', 'failed',
    'skipped_budget_exhausted', 'skipped_provider_unavailable'
  )),
  cancelled_reason text,
  enqueued_at timestamptz NOT NULL DEFAULT now(),
  enqueued_by jsonb NOT NULL,
  started_at timestamptz,
  completed_at timestamptz,
  resulting_snapshot_observed_at timestamptz,
  failure_reason text,
  worker_id text,
  heartbeat_at timestamptz,
  attempt_count int NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_scan_queue_status_priority ON scan_queue(status, priority DESC, enqueued_at ASC);
CREATE INDEX IF NOT EXISTS idx_scan_queue_tenant ON scan_queue(tenant_id, status, enqueued_at DESC);
CREATE INDEX IF NOT EXISTS idx_scan_queue_heartbeat ON scan_queue(heartbeat_at) WHERE status = 'running';

-- =============================================================================
-- 6. History tables (Phase 5; included here for completeness)
-- =============================================================================
CREATE TABLE IF NOT EXISTS report_score_history (
  id uuid PRIMARY KEY,
  tenant_id text,
  company_id text NOT NULL,
  observed_at timestamptz NOT NULL,
  authority_score jsonb NOT NULL,
  ai_visibility_score jsonb NOT NULL,
  maturity text NOT NULL,
  maturity_stage text NOT NULL,
  scan_profile text NOT NULL,
  source_metadata jsonb NOT NULL,
  UNIQUE (company_id, observed_at)
);
CREATE INDEX IF NOT EXISTS idx_report_score_history_company_time ON report_score_history(company_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_report_score_history_tenant_time ON report_score_history(tenant_id, observed_at DESC) WHERE tenant_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS report_pillar_history (
  id uuid PRIMARY KEY,
  company_id text NOT NULL,
  observed_at timestamptz NOT NULL,
  pillar text NOT NULL,
  score jsonb NOT NULL,
  primary_signal text
);
CREATE INDEX IF NOT EXISTS idx_pillar_history_company_pillar_time ON report_pillar_history(company_id, pillar, observed_at DESC);

CREATE TABLE IF NOT EXISTS report_provider_history (
  id uuid PRIMARY KEY,
  company_id text NOT NULL,
  observed_at timestamptz NOT NULL,
  provider_id text NOT NULL,
  outcome text NOT NULL,
  latency_ms int,
  cache_hit bool NOT NULL DEFAULT false,
  reason text
);
CREATE INDEX IF NOT EXISTS idx_provider_history_company_time ON report_provider_history(company_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_provider_history_provider_time ON report_provider_history(provider_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS report_recommendation_history (
  id uuid PRIMARY KEY,
  company_id text NOT NULL,
  observed_at timestamptz NOT NULL,
  action_id text NOT NULL,
  title text NOT NULL,
  pillar text NOT NULL,
  severity text NOT NULL,
  leverage_score int NOT NULL,
  status text NOT NULL CHECK (status IN ('first_seen', 'persistent', 'resolved', 'regressed'))
);
CREATE INDEX IF NOT EXISTS idx_rec_history_action ON report_recommendation_history(company_id, action_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS report_evidence_history (
  id uuid PRIMARY KEY,
  company_id text NOT NULL,
  observed_at timestamptz NOT NULL,
  scope jsonb NOT NULL,
  evidence_count int NOT NULL,
  evidence_sources jsonb NOT NULL,
  signal_summary jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_evidence_history_company_time ON report_evidence_history(company_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS report_benchmark_history (
  id uuid PRIMARY KEY,
  company_id text NOT NULL,
  observed_at timestamptz NOT NULL,
  vertical text,
  size_band text NOT NULL,
  peer_count int NOT NULL,
  percentile int,
  median_snapshot jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_benchmark_history_company_time ON report_benchmark_history(company_id, observed_at DESC);

-- =============================================================================
-- 7. Retention helper view (operators query this to find purge candidates)
-- =============================================================================
CREATE OR REPLACE VIEW retention_candidates AS
  SELECT
    'report_score_history' AS table_name,
    rsh.company_id,
    rsh.observed_at,
    rsh.tenant_id
  FROM report_score_history rsh
  UNION ALL
  SELECT
    'report_provider_history' AS table_name,
    rph.company_id,
    rph.observed_at,
    NULL AS tenant_id
  FROM report_provider_history rph
  UNION ALL
  SELECT
    'audit_log' AS table_name,
    NULL AS company_id,
    al.occurred_at AS observed_at,
    al.tenant_id
  FROM audit_log al;

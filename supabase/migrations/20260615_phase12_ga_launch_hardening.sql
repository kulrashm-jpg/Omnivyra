-- Phase 12 — Final production readiness: platform stabilization, SRE
-- operations, supportability, governance convergence, resilience advisory,
-- customer operations, observability convergence. Fully additive.

-- ---------------------------------------------------------------------------
-- PLATFORM STABILIZATION WINDOWS + APPEND-ONLY EVENT LOG
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_stabilization_windows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  window_name TEXT NOT NULL,
  freeze_mode TEXT NOT NULL DEFAULT 'soft',
  freeze_scope TEXT NOT NULL DEFAULT 'platform',
  state TEXT NOT NULL DEFAULT 'planned',
  scheduled_start TIMESTAMPTZ NOT NULL,
  scheduled_end TIMESTAMPTZ NOT NULL,
  activated_at TIMESTAMPTZ NULL,
  closed_at TIMESTAMPTZ NULL,
  activated_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  closed_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  rationale TEXT NULL,
  bounded_scope JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT stab_window_freeze_mode_check
    CHECK (freeze_mode IN ('soft','hard','emergency_pause','degradation_only')),
  CONSTRAINT stab_window_freeze_scope_check
    CHECK (freeze_scope IN ('platform','rollouts','migrations','semantic','replay','connectors','executions')),
  CONSTRAINT stab_window_state_check
    CHECK (state IN ('planned','active','closed','cancelled','expired')),
  CONSTRAINT stab_window_name_length CHECK (length(window_name) BETWEEN 1 AND 200),
  CONSTRAINT stab_window_time_order CHECK (scheduled_end > scheduled_start)
);

CREATE INDEX IF NOT EXISTS idx_stab_windows_org_state
  ON platform_stabilization_windows (organization_id, state, scheduled_start DESC);

CREATE TABLE IF NOT EXISTS platform_stabilization_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  window_id UUID NOT NULL REFERENCES platform_stabilization_windows(id) ON DELETE CASCADE,
  event_kind TEXT NOT NULL,
  previous_state TEXT NULL,
  new_state TEXT NOT NULL,
  actor_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  rationale TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT stab_event_kind_check
    CHECK (event_kind IN ('planned','activated','extended','closed','cancelled','expired','freeze_applied','freeze_released'))
);

CREATE INDEX IF NOT EXISTS idx_stab_events_window_recent
  ON platform_stabilization_events (window_id, created_at DESC);

CREATE OR REPLACE FUNCTION trg_stab_events_block_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    RAISE EXCEPTION 'platform_stabilization_events is append-only';
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS stab_events_block_update ON platform_stabilization_events;
CREATE TRIGGER stab_events_block_update
  BEFORE UPDATE ON platform_stabilization_events
  FOR EACH ROW EXECUTE FUNCTION trg_stab_events_block_mutation();
DROP TRIGGER IF EXISTS stab_events_block_delete ON platform_stabilization_events;
CREATE TRIGGER stab_events_block_delete
  BEFORE DELETE ON platform_stabilization_events
  FOR EACH ROW EXECUTE FUNCTION trg_stab_events_block_mutation();

-- ---------------------------------------------------------------------------
-- SRE HEALTH SNAPSHOTS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sre_health_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  snapshot_kind TEXT NOT NULL,
  health_state TEXT NOT NULL DEFAULT 'healthy',
  measures JSONB NOT NULL DEFAULT '{}'::jsonb,
  heatmap JSONB NOT NULL DEFAULT '[]'::jsonb,
  derivation_explanation TEXT NULL,
  generated_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sre_snapshot_kind_check
    CHECK (snapshot_kind IN (
      'runtime_dependency_health','queue_saturation','projection_lag_heatmap',
      'semantic_backlog_heatmap','replay_backlog','connector_degradation_map'
    )),
  CONSTRAINT sre_health_state_check
    CHECK (health_state IN ('healthy','degraded','critical','unknown'))
);

CREATE INDEX IF NOT EXISTS idx_sre_snapshots_org_kind
  ON sre_health_snapshots (organization_id, snapshot_kind, created_at DESC);

-- ---------------------------------------------------------------------------
-- SUPPORT SNAPSHOTS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS support_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  snapshot_kind TEXT NOT NULL,
  scope_description TEXT NULL,
  payload_inline JSONB NULL,
  payload_hash TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  byte_size INTEGER NOT NULL DEFAULT 0,
  redaction_applied JSONB NOT NULL DEFAULT '[]'::jsonb,
  linked_incident_id UUID NULL REFERENCES intelligence_incidents(id) ON DELETE SET NULL,
  linked_replay_id UUID NULL REFERENCES replay_operations(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'complete',
  failure_reason TEXT NULL,
  generated_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT support_snapshot_kind_check
    CHECK (snapshot_kind IN (
      'support_bundle','issue_reproduction','tenant_diagnostic','execution_replay_ref',
      'incident_bundle','operational_trace'
    )),
  CONSTRAINT support_snapshot_status_check
    CHECK (status IN ('complete','partial','failed','cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_support_snapshots_org_kind
  ON support_snapshots (organization_id, snapshot_kind, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_snapshots_incident
  ON support_snapshots (organization_id, linked_incident_id) WHERE linked_incident_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- GOVERNANCE CONVERGENCE SCORES
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS governance_convergence_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  scope_kind TEXT NOT NULL,
  convergence_score NUMERIC NOT NULL DEFAULT 0,
  drift_score NUMERIC NOT NULL DEFAULT 0,
  risk_overlays JSONB NOT NULL DEFAULT '[]'::jsonb,
  contributing_components JSONB NOT NULL DEFAULT '[]'::jsonb,
  derivation_explanation TEXT NULL,
  generated_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT gov_convergence_scope_check
    CHECK (scope_kind IN (
      'overall','rollout','safeguards','sla','resilience','operational_risk','governance_drift'
    )),
  CONSTRAINT gov_convergence_score_bound CHECK (convergence_score BETWEEN 0 AND 1),
  CONSTRAINT gov_convergence_drift_bound CHECK (drift_score BETWEEN 0 AND 1)
);

CREATE INDEX IF NOT EXISTS idx_gov_convergence_org_scope
  ON governance_convergence_scores (organization_id, scope_kind, created_at DESC);

-- ---------------------------------------------------------------------------
-- RESILIENCE ADVISORY PLANS (advisory only — never auto-execute)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS resilience_advisory_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  plan_kind TEXT NOT NULL,
  trigger_summary TEXT NOT NULL,
  recommended_steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  bounded_batch_size INTEGER NOT NULL DEFAULT 100,
  evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  derivation_explanation TEXT NULL,
  status TEXT NOT NULL DEFAULT 'advisory',
  acknowledged_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  acknowledged_at TIMESTAMPTZ NULL,
  generated_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT resilience_plan_kind_check
    CHECK (plan_kind IN ('recovery','replay','stabilization','rollback_preparation','partition_recovery')),
  CONSTRAINT resilience_plan_status_check
    CHECK (status IN ('advisory','acknowledged','superseded','expired')),
  CONSTRAINT resilience_plan_batch_bound CHECK (bounded_batch_size BETWEEN 1 AND 10000)
);

CREATE INDEX IF NOT EXISTS idx_resilience_advisory_org_kind
  ON resilience_advisory_plans (organization_id, plan_kind, created_at DESC);

-- ---------------------------------------------------------------------------
-- CUSTOMER OPERATIONS SCORES
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customer_operations_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  score_kind TEXT NOT NULL,
  score_value NUMERIC NOT NULL DEFAULT 0,
  components JSONB NOT NULL DEFAULT '[]'::jsonb,
  rationale TEXT NULL,
  generated_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT customer_ops_score_kind_check
    CHECK (score_kind IN (
      'tenant_readiness','rollout_cohort','onboarding_completion',
      'operational_maturity','tenant_health','support_escalation_readiness'
    )),
  CONSTRAINT customer_ops_score_bound CHECK (score_value BETWEEN 0 AND 1)
);

CREATE INDEX IF NOT EXISTS idx_customer_ops_org_kind
  ON customer_operations_scores (organization_id, score_kind, created_at DESC);

-- ---------------------------------------------------------------------------
-- OBSERVABILITY CONVERGENCE PROJECTIONS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS observability_convergence_projections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  projection_kind TEXT NOT NULL,
  unified_health_state TEXT NOT NULL DEFAULT 'healthy',
  timeline JSONB NOT NULL DEFAULT '[]'::jsonb,
  drift_detected BOOLEAN NOT NULL DEFAULT FALSE,
  resilience_overlays JSONB NOT NULL DEFAULT '[]'::jsonb,
  derivation_explanation TEXT NULL,
  bounded_window_start TIMESTAMPTZ NOT NULL,
  bounded_window_end TIMESTAMPTZ NOT NULL,
  generated_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT obs_convergence_kind_check
    CHECK (projection_kind IN ('runtime','rollout','sla','semantic','replay','safeguards','governance','unified')),
  CONSTRAINT obs_convergence_state_check
    CHECK (unified_health_state IN ('healthy','degraded','critical','unknown')),
  CONSTRAINT obs_convergence_window_order CHECK (bounded_window_end > bounded_window_start)
);

CREATE INDEX IF NOT EXISTS idx_obs_convergence_org_kind
  ON observability_convergence_projections (organization_id, projection_kind, created_at DESC);

-- ---------------------------------------------------------------------------
-- updated_at triggers (Phase 12 set)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_phase12_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stab_windows_set_updated_at ON platform_stabilization_windows;
CREATE TRIGGER stab_windows_set_updated_at BEFORE UPDATE ON platform_stabilization_windows
  FOR EACH ROW EXECUTE FUNCTION trg_phase12_set_updated_at();

DROP TRIGGER IF EXISTS resilience_advisory_set_updated_at ON resilience_advisory_plans;
CREATE TRIGGER resilience_advisory_set_updated_at BEFORE UPDATE ON resilience_advisory_plans
  FOR EACH ROW EXECUTE FUNCTION trg_phase12_set_updated_at();

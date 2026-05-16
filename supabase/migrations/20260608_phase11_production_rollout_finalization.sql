-- Phase 11 — Production rollout completion, operational safety rails,
-- bounded copilot, deployment telemetry, tenant onboarding runtime,
-- migration tooling, resilience validation, production certification.
-- Fully additive. No edits to existing tables.

-- ---------------------------------------------------------------------------
-- PRODUCTION ROLLOUT PLANS + STAGES
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS production_rollout_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  plan_name TEXT NOT NULL,
  rollout_kind TEXT NOT NULL,
  description TEXT NULL,
  ordered_stages JSONB NOT NULL DEFAULT '[]'::jsonb,
  dependency_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'drafted',
  bounded_batch_size INTEGER NOT NULL DEFAULT 50,
  owner_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  approved_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ NULL,
  rolled_back_at TIMESTAMPTZ NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT rollout_kind_check
    CHECK (rollout_kind IN (
      'tenant_activation','connector_rollout','semantic_rollout',
      'feature_rollout','runtime_upgrade','full_production'
    )),
  CONSTRAINT rollout_status_check
    CHECK (status IN ('drafted','approved','executing','complete','failed','rolled_back','cancelled')),
  CONSTRAINT rollout_name_length CHECK (length(plan_name) BETWEEN 1 AND 200),
  CONSTRAINT rollout_batch_bound CHECK (bounded_batch_size BETWEEN 1 AND 10000)
);

CREATE INDEX IF NOT EXISTS idx_rollout_plans_org_status
  ON production_rollout_plans (organization_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS production_rollout_stage_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES production_rollout_plans(id) ON DELETE CASCADE,
  stage_index INTEGER NOT NULL,
  stage_kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  checkpoint_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  verified_at TIMESTAMPTZ NULL,
  verified_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  failure_reason TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT rollout_stage_status_check
    CHECK (status IN ('pending','executing','verified','failed','rolled_back','skipped')),
  CONSTRAINT rollout_stage_unique UNIQUE (plan_id, stage_index)
);

CREATE INDEX IF NOT EXISTS idx_rollout_stages_plan
  ON production_rollout_stage_executions (plan_id, stage_index);

CREATE INDEX IF NOT EXISTS idx_rollout_stages_org_status
  ON production_rollout_stage_executions (organization_id, status, updated_at DESC);

-- ---------------------------------------------------------------------------
-- OPERATIONAL SAFETY RAILS
-- (sits next to Phase 10 production_safeguard_states; broader-scope rails
--  cover execution, replay, semantic, connector degradation, rollout freeze,
--  runtime overload, and the operator acknowledgment gate.)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS operational_safety_rails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  rail_kind TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'green',
  threshold_value NUMERIC NOT NULL DEFAULT 0,
  observed_value NUMERIC NOT NULL DEFAULT 0,
  acknowledgement_required BOOLEAN NOT NULL DEFAULT FALSE,
  acknowledged_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  acknowledged_at TIMESTAMPTZ NULL,
  override_rationale TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT safety_rail_kind_check
    CHECK (rail_kind IN (
      'execution_safety','replay_safety','semantic_indexing_safety',
      'connector_degradation','rollout_freeze','runtime_overload','operator_ack_gate'
    )),
  CONSTRAINT safety_rail_state_check
    CHECK (state IN ('green','warn','triggered','overridden','frozen','disabled')),
  CONSTRAINT safety_rail_unique UNIQUE (organization_id, rail_kind)
);

CREATE INDEX IF NOT EXISTS idx_safety_rails_org_state
  ON operational_safety_rails (organization_id, state);

CREATE TABLE IF NOT EXISTS operational_safety_rail_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  rail_id UUID NOT NULL REFERENCES operational_safety_rails(id) ON DELETE CASCADE,
  event_kind TEXT NOT NULL,
  previous_state TEXT NULL,
  new_state TEXT NOT NULL,
  observed_value NUMERIC NOT NULL,
  threshold_value NUMERIC NOT NULL,
  actor_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  rationale TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT safety_rail_event_kind_check
    CHECK (event_kind IN ('threshold_triggered','override_applied','acknowledged','frozen','recovered','re_armed','disabled'))
);

CREATE INDEX IF NOT EXISTS idx_safety_rail_events_rail_recent
  ON operational_safety_rail_events (rail_id, created_at DESC);

CREATE OR REPLACE FUNCTION trg_safety_rail_events_block_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    RAISE EXCEPTION 'operational_safety_rail_events is append-only';
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS safety_rail_events_block_update ON operational_safety_rail_events;
CREATE TRIGGER safety_rail_events_block_update
  BEFORE UPDATE ON operational_safety_rail_events
  FOR EACH ROW EXECUTE FUNCTION trg_safety_rail_events_block_mutation();
DROP TRIGGER IF EXISTS safety_rail_events_block_delete ON operational_safety_rail_events;
CREATE TRIGGER safety_rail_events_block_delete
  BEFORE DELETE ON operational_safety_rail_events
  FOR EACH ROW EXECUTE FUNCTION trg_safety_rail_events_block_mutation();

-- ---------------------------------------------------------------------------
-- BOUNDED COPILOT RESPONSES
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS copilot_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  copilot_intent TEXT NOT NULL,
  subject_ref TEXT NOT NULL,
  prompt_text TEXT NOT NULL,
  response_text TEXT NOT NULL,
  evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  retrieval_explanation_id UUID NULL REFERENCES semantic_retrieval_explanations(id) ON DELETE SET NULL,
  reasoning_summary TEXT NULL,
  context_tokens_used INTEGER NOT NULL DEFAULT 0,
  bounded_context_window INTEGER NOT NULL DEFAULT 4000,
  generation_method TEXT NOT NULL DEFAULT 'deterministic_copilot_v1',
  requested_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT copilot_intent_check
    CHECK (copilot_intent IN (
      'investigation_assist','retrieval_summary','trend_interpret',
      'opportunity_explain','escalation_draft','report_draft','governance_guidance'
    )),
  CONSTRAINT copilot_generation_method_check
    CHECK (generation_method IN ('deterministic_copilot_v1','retrieval_grounded_v1')),
  CONSTRAINT copilot_prompt_length CHECK (length(prompt_text) BETWEEN 1 AND 4000)
);

CREATE INDEX IF NOT EXISTS idx_copilot_org_intent
  ON copilot_responses (organization_id, copilot_intent, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_copilot_subject
  ON copilot_responses (organization_id, subject_ref, created_at DESC);

-- ---------------------------------------------------------------------------
-- DEPLOYMENT TELEMETRY SNAPSHOTS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS deployment_telemetry_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  snapshot_kind TEXT NOT NULL,
  health_state TEXT NOT NULL DEFAULT 'healthy',
  measures JSONB NOT NULL DEFAULT '{}'::jsonb,
  derivation_explanation TEXT NULL,
  generated_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT deployment_snapshot_kind_check
    CHECK (snapshot_kind IN (
      'rollout_progress','migration_progress','connector_rollout','semantic_rollout',
      'replay_drift','deployment_health_overview'
    )),
  CONSTRAINT deployment_health_state_check
    CHECK (health_state IN ('healthy','degraded','critical','unknown'))
);

CREATE INDEX IF NOT EXISTS idx_deployment_snapshots_org_kind
  ON deployment_telemetry_snapshots (organization_id, snapshot_kind, created_at DESC);

-- ---------------------------------------------------------------------------
-- TENANT ONBOARDING RUNTIME (stage-by-stage progression)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenant_onboarding_runtime_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  stage_kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  readiness_score NUMERIC NOT NULL DEFAULT 0,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  progression_explanation TEXT NULL,
  acknowledged_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  acknowledged_at TIMESTAMPTZ NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tenant_onboarding_stage_kind_check
    CHECK (stage_kind IN (
      'workspace_setup','rbac_verification','governance_verification',
      'connector_readiness','semantic_readiness','retention_setup','final_acknowledgement'
    )),
  CONSTRAINT tenant_onboarding_status_check
    CHECK (status IN ('pending','in_progress','blocked','complete','skipped')),
  CONSTRAINT tenant_onboarding_unique UNIQUE (organization_id, stage_kind),
  CONSTRAINT tenant_onboarding_score_bound CHECK (readiness_score BETWEEN 0 AND 1)
);

CREATE INDEX IF NOT EXISTS idx_tenant_onboarding_org
  ON tenant_onboarding_runtime_stages (organization_id, status);

-- ---------------------------------------------------------------------------
-- MIGRATION DRY-RUN TOOLING
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS migration_dry_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  migration_kind TEXT NOT NULL,
  migration_identifier TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'previewed',
  dependency_checks JSONB NOT NULL DEFAULT '[]'::jsonb,
  rollback_plan JSONB NOT NULL DEFAULT '{}'::jsonb,
  execution_audit JSONB NOT NULL DEFAULT '[]'::jsonb,
  health_verdict TEXT NULL,
  requested_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT migration_dry_run_kind_check
    CHECK (migration_kind IN ('schema','data_backfill','config','feature_flag','retention','custom')),
  CONSTRAINT migration_dry_run_status_check
    CHECK (status IN ('previewed','verified','blocked','executed','failed','rolled_back','cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_migration_dry_runs_org_status
  ON migration_dry_runs (organization_id, status, updated_at DESC);

-- ---------------------------------------------------------------------------
-- RESILIENCE VALIDATION RUNS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS resilience_validation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  validation_kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'complete',
  observed_results JSONB NOT NULL DEFAULT '[]'::jsonb,
  failure_explanation TEXT NULL,
  bounded_window_start TIMESTAMPTZ NOT NULL,
  bounded_window_end TIMESTAMPTZ NOT NULL,
  initiated_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT resilience_validation_kind_check
    CHECK (validation_kind IN (
      'replay_integrity','semantic_consistency','projection_consistency',
      'partition_health','connector_resilience','failover_readiness'
    )),
  CONSTRAINT resilience_validation_status_check
    CHECK (status IN ('complete','partial','failed','cancelled')),
  CONSTRAINT resilience_validation_window_order CHECK (bounded_window_end > bounded_window_start)
);

CREATE INDEX IF NOT EXISTS idx_resilience_validations_org_kind
  ON resilience_validation_runs (organization_id, validation_kind, created_at DESC);

-- ---------------------------------------------------------------------------
-- PRODUCTION CERTIFICATION REPORTS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS production_certification_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  certification_kind TEXT NOT NULL,
  certification_score NUMERIC NOT NULL DEFAULT 0,
  components JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  derivation_explanation TEXT NULL,
  status TEXT NOT NULL DEFAULT 'complete',
  generated_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cert_kind_check
    CHECK (certification_kind IN (
      'operational_readiness','governance_readiness','deployment_readiness',
      'sla_readiness','resilience_certification','audit_readiness'
    )),
  CONSTRAINT cert_status_check CHECK (status IN ('complete','partial','failed')),
  CONSTRAINT cert_score_bound CHECK (certification_score BETWEEN 0 AND 1)
);

CREATE INDEX IF NOT EXISTS idx_certification_reports_org_kind
  ON production_certification_reports (organization_id, certification_kind, created_at DESC);

-- ---------------------------------------------------------------------------
-- updated_at triggers (Phase 11 set)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_phase11_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rollout_plans_set_updated_at ON production_rollout_plans;
CREATE TRIGGER rollout_plans_set_updated_at BEFORE UPDATE ON production_rollout_plans
  FOR EACH ROW EXECUTE FUNCTION trg_phase11_set_updated_at();

DROP TRIGGER IF EXISTS rollout_stages_set_updated_at ON production_rollout_stage_executions;
CREATE TRIGGER rollout_stages_set_updated_at BEFORE UPDATE ON production_rollout_stage_executions
  FOR EACH ROW EXECUTE FUNCTION trg_phase11_set_updated_at();

DROP TRIGGER IF EXISTS safety_rails_set_updated_at ON operational_safety_rails;
CREATE TRIGGER safety_rails_set_updated_at BEFORE UPDATE ON operational_safety_rails
  FOR EACH ROW EXECUTE FUNCTION trg_phase11_set_updated_at();

DROP TRIGGER IF EXISTS tenant_onboarding_runtime_set_updated_at ON tenant_onboarding_runtime_stages;
CREATE TRIGGER tenant_onboarding_runtime_set_updated_at BEFORE UPDATE ON tenant_onboarding_runtime_stages
  FOR EACH ROW EXECUTE FUNCTION trg_phase11_set_updated_at();

DROP TRIGGER IF EXISTS migration_dry_runs_set_updated_at ON migration_dry_runs;
CREATE TRIGGER migration_dry_runs_set_updated_at BEFORE UPDATE ON migration_dry_runs
  FOR EACH ROW EXECUTE FUNCTION trg_phase11_set_updated_at();

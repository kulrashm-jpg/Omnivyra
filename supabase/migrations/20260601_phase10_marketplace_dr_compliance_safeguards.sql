-- Phase 10 — Connector marketplace + sandbox, enterprise onboarding,
-- AI-assisted investigation, long-window trends, disaster recovery,
-- compliance evidence, analyst macros, production safeguards.
-- Fully additive. No edits to existing tables.

-- ---------------------------------------------------------------------------
-- MARKETPLACE CONNECTOR REGISTRY
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marketplace_connector_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  connector_slug TEXT NOT NULL,
  display_name TEXT NOT NULL,
  vendor TEXT NOT NULL,
  version TEXT NOT NULL,
  capability_tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  dependency_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  signed_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  signature_hash TEXT NOT NULL,
  certification_state TEXT NOT NULL DEFAULT 'uncertified',
  rollout_state TEXT NOT NULL DEFAULT 'inactive',
  activated_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  activated_at TIMESTAMPTZ NULL,
  retired_at TIMESTAMPTZ NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT marketplace_certification_check
    CHECK (certification_state IN ('uncertified','review','certified','rejected','revoked')),
  CONSTRAINT marketplace_rollout_check
    CHECK (rollout_state IN ('inactive','staged','active','retired')),
  CONSTRAINT marketplace_unique_per_org UNIQUE (organization_id, connector_slug, version)
);

CREATE INDEX IF NOT EXISTS idx_marketplace_connectors_org_rollout
  ON marketplace_connector_definitions (organization_id, rollout_state, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_marketplace_connectors_org_cert
  ON marketplace_connector_definitions (organization_id, certification_state);

-- Append-only certification history
CREATE TABLE IF NOT EXISTS marketplace_connector_certifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  marketplace_connector_id UUID NOT NULL REFERENCES marketplace_connector_definitions(id) ON DELETE CASCADE,
  previous_state TEXT NULL,
  new_state TEXT NOT NULL,
  reason TEXT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT marketplace_cert_state_check
    CHECK (new_state IN ('uncertified','review','certified','rejected','revoked'))
);

CREATE INDEX IF NOT EXISTS idx_marketplace_certs_connector_recent
  ON marketplace_connector_certifications (marketplace_connector_id, created_at DESC);

CREATE OR REPLACE FUNCTION trg_marketplace_certs_block_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    RAISE EXCEPTION 'marketplace_connector_certifications is append-only';
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS marketplace_certs_block_update ON marketplace_connector_certifications;
CREATE TRIGGER marketplace_certs_block_update
  BEFORE UPDATE ON marketplace_connector_certifications
  FOR EACH ROW EXECUTE FUNCTION trg_marketplace_certs_block_mutation();
DROP TRIGGER IF EXISTS marketplace_certs_block_delete ON marketplace_connector_certifications;
CREATE TRIGGER marketplace_certs_block_delete
  BEFORE DELETE ON marketplace_connector_certifications
  FOR EACH ROW EXECUTE FUNCTION trg_marketplace_certs_block_mutation();

-- ---------------------------------------------------------------------------
-- CONNECTOR SANDBOX
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS connector_sandbox_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  marketplace_connector_id UUID NOT NULL REFERENCES marketplace_connector_definitions(id) ON DELETE CASCADE,
  capability_restrictions JSONB NOT NULL DEFAULT '[]'::jsonb,
  max_execution_seconds INTEGER NOT NULL DEFAULT 60,
  max_ingestion_items INTEGER NOT NULL DEFAULT 500,
  max_cost_units INTEGER NOT NULL DEFAULT 1000,
  network_allowlist JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sandbox_policy_unique UNIQUE (organization_id, marketplace_connector_id),
  CONSTRAINT sandbox_exec_seconds_bound CHECK (max_execution_seconds BETWEEN 1 AND 600),
  CONSTRAINT sandbox_ingestion_bound CHECK (max_ingestion_items BETWEEN 1 AND 100000),
  CONSTRAINT sandbox_cost_bound CHECK (max_cost_units BETWEEN 1 AND 100000)
);

CREATE INDEX IF NOT EXISTS idx_sandbox_policies_org
  ON connector_sandbox_policies (organization_id);

CREATE TABLE IF NOT EXISTS connector_sandbox_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  marketplace_connector_id UUID NOT NULL REFERENCES marketplace_connector_definitions(id) ON DELETE CASCADE,
  capability_invoked TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  duration_ms INTEGER NULL,
  items_ingested INTEGER NOT NULL DEFAULT 0,
  cost_units INTEGER NOT NULL DEFAULT 0,
  enforcement_decisions JSONB NOT NULL DEFAULT '[]'::jsonb,
  initiated_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  failure_reason TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sandbox_exec_status_check
    CHECK (status IN ('queued','running','complete','failed','quota_exceeded','timed_out','cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_sandbox_executions_org_recent
  ON connector_sandbox_executions (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sandbox_executions_connector
  ON connector_sandbox_executions (marketplace_connector_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- ENTERPRISE ONBOARDING
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS enterprise_onboarding_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NULL REFERENCES companies(id) ON DELETE CASCADE,
  template_kind TEXT NOT NULL,
  name TEXT NOT NULL,
  industry TEXT NULL,
  description TEXT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  recommended_explanation TEXT NULL,
  shared BOOLEAN NOT NULL DEFAULT FALSE,
  owner_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT onboarding_template_kind_check
    CHECK (template_kind IN (
      'industry_preset','source_recommendation','governance_baseline',
      'connector_activation','rbac_starter','retention_preset'
    )),
  CONSTRAINT onboarding_template_name_length CHECK (length(name) BETWEEN 1 AND 200)
);

CREATE INDEX IF NOT EXISTS idx_onboarding_templates_org_kind
  ON enterprise_onboarding_templates (organization_id, template_kind);

CREATE INDEX IF NOT EXISTS idx_onboarding_templates_shared
  ON enterprise_onboarding_templates (template_kind) WHERE shared = TRUE;

CREATE TABLE IF NOT EXISTS enterprise_onboarding_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  template_id UUID NULL REFERENCES enterprise_onboarding_templates(id) ON DELETE SET NULL,
  template_kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'previewed',
  approved_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ NULL,
  applied_at TIMESTAMPTZ NULL,
  preview_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  applied_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  failure_reason TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT onboarding_app_status_check
    CHECK (status IN ('previewed','approved','applied','rolled_back','failed','cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_onboarding_applications_org_status
  ON enterprise_onboarding_applications (organization_id, status, created_at DESC);

-- ---------------------------------------------------------------------------
-- AI-ASSISTED INVESTIGATION
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS investigation_ai_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  investigation_kind TEXT NOT NULL,
  subject_ref TEXT NOT NULL,
  summary_text TEXT NOT NULL,
  evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  retrieval_explanation_id UUID NULL REFERENCES semantic_retrieval_explanations(id) ON DELETE SET NULL,
  generation_method TEXT NOT NULL DEFAULT 'deterministic_summary_v1',
  context_tokens_used INTEGER NULL,
  bounded_context_window INTEGER NOT NULL DEFAULT 4000,
  requested_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT investigation_ai_kind_check
    CHECK (investigation_kind IN (
      'incident_summary','cluster_explanation','timeline_summary',
      'evidence_grouping','retrieval_overlay','escalation_brief'
    )),
  CONSTRAINT investigation_ai_method_check
    CHECK (generation_method IN ('deterministic_summary_v1','retrieval_assist_v1'))
);

CREATE INDEX IF NOT EXISTS idx_investigation_ai_org_kind
  ON investigation_ai_summaries (organization_id, investigation_kind, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_investigation_ai_subject
  ON investigation_ai_summaries (organization_id, subject_ref, created_at DESC);

-- ---------------------------------------------------------------------------
-- LONG-WINDOW INTELLIGENCE TRENDS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS intelligence_trend_aggregations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  trend_kind TEXT NOT NULL,
  window_kind TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,
  series JSONB NOT NULL DEFAULT '[]'::jsonb,
  derivation_explanation TEXT NULL,
  initiated_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT trend_kind_check
    CHECK (trend_kind IN (
      'opportunity_long','competitor_movement','source_quality',
      'moderation_trend','conversion_trend','escalation_pattern'
    )),
  CONSTRAINT trend_window_kind_check
    CHECK (window_kind IN ('30d','90d','180d','365d')),
  CONSTRAINT trend_window_order CHECK (window_end > window_start),
  CONSTRAINT trend_unique
    UNIQUE (organization_id, trend_kind, window_kind, window_start, dimensions)
);

CREATE INDEX IF NOT EXISTS idx_trend_aggregations_org_kind
  ON intelligence_trend_aggregations (organization_id, trend_kind, window_start DESC);

-- ---------------------------------------------------------------------------
-- DISASTER RECOVERY
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS disaster_recovery_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  plan_kind TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NULL,
  ordered_steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  expected_runtime_minutes INTEGER NOT NULL DEFAULT 30,
  bounded_batch_size INTEGER NOT NULL DEFAULT 100,
  owner_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT dr_plan_kind_check
    CHECK (plan_kind IN (
      'projection_rebuild','queue_recovery','semantic_index_rebuild',
      'partition_recovery','failover_validation','full_recovery'
    )),
  CONSTRAINT dr_plan_name_length CHECK (length(name) BETWEEN 1 AND 200),
  CONSTRAINT dr_plan_batch_bound CHECK (bounded_batch_size BETWEEN 1 AND 10000)
);

CREATE INDEX IF NOT EXISTS idx_dr_plans_org_kind
  ON disaster_recovery_plans (organization_id, plan_kind);

CREATE TABLE IF NOT EXISTS disaster_recovery_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  plan_id UUID NULL REFERENCES disaster_recovery_plans(id) ON DELETE SET NULL,
  plan_kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  step_results JSONB NOT NULL DEFAULT '[]'::jsonb,
  initiated_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  approved_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ NULL,
  started_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  failure_reason TEXT NULL,
  observability JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT dr_exec_status_check
    CHECK (status IN ('planned','approved','executing','complete','failed','cancelled','rolled_back'))
);

CREATE INDEX IF NOT EXISTS idx_dr_executions_org_status
  ON disaster_recovery_executions (organization_id, status, created_at DESC);

-- ---------------------------------------------------------------------------
-- COMPLIANCE EVIDENCE
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS compliance_evidence_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  evidence_kind TEXT NOT NULL,
  certification_target TEXT NOT NULL DEFAULT 'soc2',
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  byte_size INTEGER NOT NULL DEFAULT 0,
  payload_inline JSONB NULL,
  payload_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'complete',
  failure_reason TEXT NULL,
  generated_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT evidence_kind_check
    CHECK (evidence_kind IN (
      'governance_traceability','retention_audit','replay_audit',
      'access_audit','operational_change_log','consent_log','full_bundle'
    )),
  CONSTRAINT evidence_status_check
    CHECK (status IN ('complete','partial','failed','cancelled')),
  CONSTRAINT evidence_target_check
    CHECK (certification_target IN ('soc2','iso27001','generic')),
  CONSTRAINT evidence_window_order CHECK (window_end > window_start)
);

CREATE INDEX IF NOT EXISTS idx_compliance_exports_org_kind
  ON compliance_evidence_exports (organization_id, evidence_kind, created_at DESC);

-- ---------------------------------------------------------------------------
-- ANALYST MACROS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS analyst_macro_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  macro_kind TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NULL,
  steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  owner_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  shared BOOLEAN NOT NULL DEFAULT FALSE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT macro_kind_check
    CHECK (macro_kind IN (
      'investigation_macro','workflow_template','evidence_bundle',
      'report_preset','saved_semantic_search','escalation_template'
    )),
  CONSTRAINT macro_name_length CHECK (length(name) BETWEEN 1 AND 200)
);

CREATE INDEX IF NOT EXISTS idx_macros_org_kind
  ON analyst_macro_definitions (organization_id, macro_kind, updated_at DESC);

CREATE TABLE IF NOT EXISTS analyst_macro_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  macro_id UUID NOT NULL REFERENCES analyst_macro_definitions(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'complete',
  step_results JSONB NOT NULL DEFAULT '[]'::jsonb,
  executed_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  failure_reason TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT macro_exec_status_check
    CHECK (status IN ('complete','partial','failed','cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_macro_executions_org_macro
  ON analyst_macro_executions (organization_id, macro_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- PRODUCTION SAFEGUARDS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS production_safeguard_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  safeguard_kind TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'armed',
  threshold_value NUMERIC NOT NULL DEFAULT 0,
  observed_value NUMERIC NOT NULL DEFAULT 0,
  triggered_at TIMESTAMPTZ NULL,
  recovered_at TIMESTAMPTZ NULL,
  last_override_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  last_override_at TIMESTAMPTZ NULL,
  rationale TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT safeguard_kind_check
    CHECK (safeguard_kind IN (
      'execution_circuit_breaker','connector_degradation','queue_congestion',
      'semantic_overload','replay_overload','operational_freeze'
    )),
  CONSTRAINT safeguard_state_check
    CHECK (state IN ('armed','tripped','recovering','overridden','disabled')),
  CONSTRAINT safeguard_unique UNIQUE (organization_id, safeguard_kind)
);

CREATE INDEX IF NOT EXISTS idx_safeguards_org_state
  ON production_safeguard_states (organization_id, state);

CREATE TABLE IF NOT EXISTS production_safeguard_triggers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  safeguard_state_id UUID NOT NULL REFERENCES production_safeguard_states(id) ON DELETE CASCADE,
  trigger_kind TEXT NOT NULL,
  observed_value NUMERIC NOT NULL,
  threshold_value NUMERIC NOT NULL,
  acted_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  rationale TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT safeguard_trigger_kind_check
    CHECK (trigger_kind IN ('tripped','overridden','recovered','disabled','re_armed'))
);

CREATE INDEX IF NOT EXISTS idx_safeguard_triggers_state_recent
  ON production_safeguard_triggers (safeguard_state_id, created_at DESC);

CREATE OR REPLACE FUNCTION trg_safeguard_triggers_block_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    RAISE EXCEPTION 'production_safeguard_triggers is append-only';
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS safeguard_triggers_block_update ON production_safeguard_triggers;
CREATE TRIGGER safeguard_triggers_block_update
  BEFORE UPDATE ON production_safeguard_triggers
  FOR EACH ROW EXECUTE FUNCTION trg_safeguard_triggers_block_mutation();
DROP TRIGGER IF EXISTS safeguard_triggers_block_delete ON production_safeguard_triggers;
CREATE TRIGGER safeguard_triggers_block_delete
  BEFORE DELETE ON production_safeguard_triggers
  FOR EACH ROW EXECUTE FUNCTION trg_safeguard_triggers_block_mutation();

-- ---------------------------------------------------------------------------
-- updated_at triggers (Phase 10 set)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_phase10_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS marketplace_connectors_set_updated_at ON marketplace_connector_definitions;
CREATE TRIGGER marketplace_connectors_set_updated_at BEFORE UPDATE ON marketplace_connector_definitions
  FOR EACH ROW EXECUTE FUNCTION trg_phase10_set_updated_at();

DROP TRIGGER IF EXISTS sandbox_policies_set_updated_at ON connector_sandbox_policies;
CREATE TRIGGER sandbox_policies_set_updated_at BEFORE UPDATE ON connector_sandbox_policies
  FOR EACH ROW EXECUTE FUNCTION trg_phase10_set_updated_at();

DROP TRIGGER IF EXISTS onboarding_templates_set_updated_at ON enterprise_onboarding_templates;
CREATE TRIGGER onboarding_templates_set_updated_at BEFORE UPDATE ON enterprise_onboarding_templates
  FOR EACH ROW EXECUTE FUNCTION trg_phase10_set_updated_at();

DROP TRIGGER IF EXISTS onboarding_applications_set_updated_at ON enterprise_onboarding_applications;
CREATE TRIGGER onboarding_applications_set_updated_at BEFORE UPDATE ON enterprise_onboarding_applications
  FOR EACH ROW EXECUTE FUNCTION trg_phase10_set_updated_at();

DROP TRIGGER IF EXISTS dr_plans_set_updated_at ON disaster_recovery_plans;
CREATE TRIGGER dr_plans_set_updated_at BEFORE UPDATE ON disaster_recovery_plans
  FOR EACH ROW EXECUTE FUNCTION trg_phase10_set_updated_at();

DROP TRIGGER IF EXISTS dr_executions_set_updated_at ON disaster_recovery_executions;
CREATE TRIGGER dr_executions_set_updated_at BEFORE UPDATE ON disaster_recovery_executions
  FOR EACH ROW EXECUTE FUNCTION trg_phase10_set_updated_at();

DROP TRIGGER IF EXISTS macro_definitions_set_updated_at ON analyst_macro_definitions;
CREATE TRIGGER macro_definitions_set_updated_at BEFORE UPDATE ON analyst_macro_definitions
  FOR EACH ROW EXECUTE FUNCTION trg_phase10_set_updated_at();

DROP TRIGGER IF EXISTS safeguard_states_set_updated_at ON production_safeguard_states;
CREATE TRIGGER safeguard_states_set_updated_at BEFORE UPDATE ON production_safeguard_states
  FOR EACH ROW EXECUTE FUNCTION trg_phase10_set_updated_at();

BEGIN;

-- MarketPulse Phase 4: executive intelligence experience, watchlists,
-- routing, lifecycle, escalation, drill-down chains, and workflow-readiness.
-- This layer prepares consumption and coordination only; it does not trigger
-- autonomous workflows or strategic recommendations.

CREATE TABLE IF NOT EXISTS marketpulse_executive_overviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  view_type TEXT NOT NULL DEFAULT 'executive',
  overview_payload JSONB NOT NULL,
  top_strategic_pressures UUID[] NOT NULL DEFAULT '{}',
  top_operational_pressures UUID[] NOT NULL DEFAULT '{}',
  emerging_risks UUID[] NOT NULL DEFAULT '{}',
  opportunity_highlights UUID[] NOT NULL DEFAULT '{}',
  worsening_conditions UUID[] NOT NULL DEFAULT '{}',
  stabilizing_conditions UUID[] NOT NULL DEFAULT '{}',
  critical_narratives UUID[] NOT NULL DEFAULT '{}',
  confidence NUMERIC(5,2) NOT NULL DEFAULT 0,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT marketpulse_executive_overviews_view_valid
    CHECK (view_type IN ('executive', 'operational', 'compliance', 'workforce', 'funding')),
  CONSTRAINT marketpulse_executive_overviews_payload_object
    CHECK (jsonb_typeof(overview_payload) = 'object'),
  CONSTRAINT marketpulse_executive_overviews_confidence_valid
    CHECK (confidence BETWEEN 0 AND 100)
);

CREATE INDEX IF NOT EXISTS idx_marketpulse_executive_overviews_company
  ON marketpulse_executive_overviews(company_id, view_type, generated_at DESC);

CREATE TABLE IF NOT EXISTS marketpulse_digest_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  digest_type TEXT NOT NULL,
  item_type TEXT NOT NULL,
  source_pressure_id UUID REFERENCES marketpulse_business_pressures(id) ON DELETE SET NULL,
  source_impact_id UUID REFERENCES marketpulse_business_impacts(id) ON DELETE SET NULL,
  source_consequence_id UUID REFERENCES marketpulse_operational_consequences(id) ON DELETE SET NULL,
  source_narrative_id UUID REFERENCES marketpulse_narratives(id) ON DELETE SET NULL,
  summary TEXT NOT NULL,
  why_this_matters TEXT NOT NULL,
  affected_areas TEXT[] NOT NULL DEFAULT '{}',
  severity NUMERIC(5,2) NOT NULL DEFAULT 0,
  confidence NUMERIC(5,2) NOT NULL DEFAULT 0,
  evolution_status TEXT NOT NULL DEFAULT 'new',
  supporting_evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  drilldown_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  priority_rank INTEGER NOT NULL DEFAULT 0,
  lifecycle_state TEXT NOT NULL DEFAULT 'new',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT marketpulse_digest_items_digest_valid
    CHECK (digest_type IN ('executive', 'operational', 'compliance', 'workforce', 'funding')),
  CONSTRAINT marketpulse_digest_items_type_valid
    CHECK (item_type IN ('pressure', 'impact', 'consequence', 'narrative')),
  CONSTRAINT marketpulse_digest_items_lifecycle_valid
    CHECK (lifecycle_state IN ('new', 'acknowledged', 'monitored', 'escalating', 'stabilized', 'resolved', 'muted')),
  CONSTRAINT marketpulse_digest_items_scores_valid
    CHECK (severity BETWEEN 0 AND 100 AND confidence BETWEEN 0 AND 100),
  CONSTRAINT marketpulse_digest_items_evidence_object
    CHECK (jsonb_typeof(supporting_evidence) = 'object'),
  CONSTRAINT marketpulse_digest_items_drilldown_object
    CHECK (jsonb_typeof(drilldown_payload) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_marketpulse_digest_items_company
  ON marketpulse_digest_items(company_id, digest_type, priority_rank, updated_at DESC);

CREATE TABLE IF NOT EXISTS marketpulse_watchlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  watchlist_type TEXT NOT NULL,
  watchlist_value TEXT NOT NULL,
  priority_level TEXT NOT NULL DEFAULT 'normal',
  muted BOOLEAN NOT NULL DEFAULT false,
  created_by UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT marketpulse_watchlists_type_valid
    CHECK (watchlist_type IN ('competitor', 'region', 'technology', 'regulation', 'industry', 'macro_theme', 'workforce_trend', 'funding_activity')),
  CONSTRAINT marketpulse_watchlists_priority_valid
    CHECK (priority_level IN ('low', 'normal', 'high', 'critical')),
  CONSTRAINT marketpulse_watchlists_unique
    UNIQUE(company_id, watchlist_type, watchlist_value)
);

CREATE INDEX IF NOT EXISTS idx_marketpulse_watchlists_company
  ON marketpulse_watchlists(company_id, watchlist_type, priority_level);

CREATE TABLE IF NOT EXISTS marketpulse_routing_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  trigger_type TEXT NOT NULL,
  trigger_value TEXT NOT NULL,
  target_department TEXT NOT NULL,
  target_roles TEXT[] NOT NULL DEFAULT '{}',
  severity_threshold NUMERIC(5,2) NOT NULL DEFAULT 50,
  escalation_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT marketpulse_routing_rules_department_valid
    CHECK (target_department IN ('leadership', 'legal_compliance', 'hr_talent', 'engineering_operations', 'finance_investor_relations', 'go_to_market', 'security', 'supply_chain')),
  CONSTRAINT marketpulse_routing_rules_threshold_valid
    CHECK (severity_threshold BETWEEN 0 AND 100)
);

CREATE INDEX IF NOT EXISTS idx_marketpulse_routing_rules_company
  ON marketpulse_routing_rules(company_id, trigger_type, trigger_value);

CREATE TABLE IF NOT EXISTS marketpulse_lifecycle_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  lifecycle_state TEXT NOT NULL DEFAULT 'new',
  severity NUMERIC(5,2) NOT NULL DEFAULT 0,
  previous_severity NUMERIC(5,2),
  last_transition_reason TEXT,
  acknowledged_by UUID NULL,
  acknowledged_at TIMESTAMPTZ,
  muted_until TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT marketpulse_lifecycle_states_entity_valid
    CHECK (entity_type IN ('pressure', 'impact', 'consequence', 'narrative', 'digest_item')),
  CONSTRAINT marketpulse_lifecycle_states_state_valid
    CHECK (lifecycle_state IN ('new', 'acknowledged', 'monitored', 'escalating', 'stabilized', 'resolved', 'muted')),
  CONSTRAINT marketpulse_lifecycle_states_severity_valid
    CHECK (severity BETWEEN 0 AND 100 AND (previous_severity IS NULL OR previous_severity BETWEEN 0 AND 100)),
  CONSTRAINT marketpulse_lifecycle_states_unique
    UNIQUE(company_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_marketpulse_lifecycle_states_company
  ON marketpulse_lifecycle_states(company_id, lifecycle_state, updated_at DESC);

CREATE TABLE IF NOT EXISTS marketpulse_escalation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  escalation_state TEXT NOT NULL,
  previous_severity NUMERIC(5,2),
  current_severity NUMERIC(5,2) NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  routed_departments TEXT[] NOT NULL DEFAULT '{}',
  alert_fatigue_guard JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT marketpulse_escalation_events_state_valid
    CHECK (escalation_state IN ('escalated', 'de_escalated', 'held', 'muted')),
  CONSTRAINT marketpulse_escalation_events_guard_object
    CHECK (jsonb_typeof(alert_fatigue_guard) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_marketpulse_escalation_events_company
  ON marketpulse_escalation_events(company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS marketpulse_workflow_hooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source_entity_type TEXT NOT NULL,
  source_entity_id UUID NOT NULL,
  hook_type TEXT NOT NULL,
  hook_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  readiness_state TEXT NOT NULL DEFAULT 'prepared',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT marketpulse_workflow_hooks_type_valid
    CHECK (hook_type IN ('task_candidate', 'meeting_context', 'investigation_candidate', 'strategic_review_context', 'leadership_summary', 'automation_candidate')),
  CONSTRAINT marketpulse_workflow_hooks_state_valid
    CHECK (readiness_state IN ('prepared', 'used', 'dismissed')),
  CONSTRAINT marketpulse_workflow_hooks_payload_object
    CHECK (jsonb_typeof(hook_payload) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_marketpulse_workflow_hooks_company
  ON marketpulse_workflow_hooks(company_id, created_at DESC);

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'marketpulse_executive_overviews',
    'marketpulse_digest_items',
    'marketpulse_watchlists',
    'marketpulse_routing_rules',
    'marketpulse_lifecycle_states',
    'marketpulse_escalation_events',
    'marketpulse_workflow_hooks'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = t
        AND policyname = 'service_role_full_access'
    ) THEN
      EXECUTE format('DROP POLICY "service_role_full_access" ON public.%I', t);
    END IF;
    EXECUTE format(
      'CREATE POLICY "service_role_full_access" ON public.%I FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')',
      t
    );
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS trg_marketpulse_digest_items_updated_at ON marketpulse_digest_items;
CREATE TRIGGER trg_marketpulse_digest_items_updated_at
BEFORE UPDATE ON marketpulse_digest_items
FOR EACH ROW EXECUTE FUNCTION omnivyra_touch_updated_at();

DROP TRIGGER IF EXISTS trg_marketpulse_watchlists_updated_at ON marketpulse_watchlists;
CREATE TRIGGER trg_marketpulse_watchlists_updated_at
BEFORE UPDATE ON marketpulse_watchlists
FOR EACH ROW EXECUTE FUNCTION omnivyra_touch_updated_at();

DROP TRIGGER IF EXISTS trg_marketpulse_routing_rules_updated_at ON marketpulse_routing_rules;
CREATE TRIGGER trg_marketpulse_routing_rules_updated_at
BEFORE UPDATE ON marketpulse_routing_rules
FOR EACH ROW EXECUTE FUNCTION omnivyra_touch_updated_at();

DROP TRIGGER IF EXISTS trg_marketpulse_lifecycle_states_updated_at ON marketpulse_lifecycle_states;
CREATE TRIGGER trg_marketpulse_lifecycle_states_updated_at
BEFORE UPDATE ON marketpulse_lifecycle_states
FOR EACH ROW EXECUTE FUNCTION omnivyra_touch_updated_at();

COMMIT;

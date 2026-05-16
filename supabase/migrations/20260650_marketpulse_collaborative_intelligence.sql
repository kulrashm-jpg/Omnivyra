BEGIN;

-- MarketPulse collaborative intelligence and organizational memory.
-- This layer records human investigation, ownership, acknowledgments,
-- decisions, annotations, and traceability. It does not execute workflows.

CREATE TABLE IF NOT EXISTS marketpulse_investigation_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  title TEXT NOT NULL,
  investigation_status TEXT NOT NULL DEFAULT 'open',
  created_by UUID NULL,
  assigned_to UUID NULL,
  priority TEXT NOT NULL DEFAULT 'normal',
  duplicate_key TEXT NOT NULL,
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  stale_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '14 days'),
  governance_flags JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT marketpulse_investigation_threads_entity_valid
    CHECK (entity_type IN ('pressure', 'impact', 'narrative', 'consequence', 'escalation', 'digest_item')),
  CONSTRAINT marketpulse_investigation_threads_status_valid
    CHECK (investigation_status IN ('open', 'investigating', 'monitoring', 'blocked', 'resolved', 'archived')),
  CONSTRAINT marketpulse_investigation_threads_priority_valid
    CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  CONSTRAINT marketpulse_investigation_threads_flags_object
    CHECK (jsonb_typeof(governance_flags) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_marketpulse_investigation_threads_company
  ON marketpulse_investigation_threads(company_id, investigation_status, priority, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_marketpulse_investigation_threads_active_dedupe
  ON marketpulse_investigation_threads(company_id, duplicate_key)
  WHERE investigation_status NOT IN ('resolved', 'archived');

CREATE TABLE IF NOT EXISTS marketpulse_investigation_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES marketpulse_investigation_threads(id) ON DELETE CASCADE,
  author_id UUID NULL,
  comment TEXT NOT NULL,
  evidence_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT marketpulse_investigation_comments_evidence_object
    CHECK (jsonb_typeof(evidence_payload) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_marketpulse_investigation_comments_thread
  ON marketpulse_investigation_comments(thread_id, created_at DESC);

CREATE TABLE IF NOT EXISTS marketpulse_entity_acknowledgments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  acknowledged_by UUID NULL,
  acknowledgment_type TEXT NOT NULL,
  notes TEXT,
  ownership_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT marketpulse_entity_acknowledgments_entity_valid
    CHECK (entity_type IN ('pressure', 'impact', 'narrative', 'consequence', 'escalation', 'digest_item')),
  CONSTRAINT marketpulse_entity_acknowledgments_type_valid
    CHECK (acknowledgment_type IN ('reviewed', 'monitoring', 'action_planned', 'escalated', 'resolved', 'dismissed')),
  CONSTRAINT marketpulse_entity_acknowledgments_ownership_object
    CHECK (jsonb_typeof(ownership_payload) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_marketpulse_entity_acknowledgments_company
  ON marketpulse_entity_acknowledgments(company_id, entity_type, entity_id, created_at DESC);

CREATE TABLE IF NOT EXISTS marketpulse_decision_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  decision_summary TEXT NOT NULL,
  rationale TEXT,
  decision_owner UUID NULL,
  outcome_status TEXT NOT NULL DEFAULT 'proposed',
  context_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT marketpulse_decision_memory_entity_valid
    CHECK (entity_type IN ('pressure', 'impact', 'narrative', 'consequence', 'escalation', 'investigation')),
  CONSTRAINT marketpulse_decision_memory_outcome_valid
    CHECK (outcome_status IN ('proposed', 'active', 'completed', 'ineffective', 'abandoned')),
  CONSTRAINT marketpulse_decision_memory_snapshot_object
    CHECK (jsonb_typeof(context_snapshot) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_marketpulse_decision_memory_company
  ON marketpulse_decision_memory(company_id, entity_type, entity_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS marketpulse_annotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  annotation_type TEXT NOT NULL,
  content TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'company',
  created_by UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT marketpulse_annotations_entity_valid
    CHECK (entity_type IN ('pressure', 'impact', 'narrative', 'consequence', 'escalation', 'digest_item', 'investigation')),
  CONSTRAINT marketpulse_annotations_type_valid
    CHECK (annotation_type IN ('strategic_note', 'contextual_commentary', 'business_nuance', 'leadership_concern', 'interpretation_note')),
  CONSTRAINT marketpulse_annotations_visibility_valid
    CHECK (visibility IN ('private', 'leadership', 'department', 'company'))
);

CREATE INDEX IF NOT EXISTS idx_marketpulse_annotations_company
  ON marketpulse_annotations(company_id, entity_type, entity_id, created_at DESC);

CREATE TABLE IF NOT EXISTS marketpulse_intelligence_action_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source_entity_type TEXT NOT NULL,
  source_entity_id UUID NOT NULL,
  target_artifact_type TEXT NOT NULL,
  target_artifact_id UUID NOT NULL,
  relationship_type TEXT NOT NULL,
  trace_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT marketpulse_intelligence_action_links_relationship_valid
    CHECK (relationship_type IN ('investigated_by', 'acknowledged_by', 'decision_recorded_for', 'annotated_by', 'workflow_hook_prepared_for')),
  CONSTRAINT marketpulse_intelligence_action_links_trace_object
    CHECK (jsonb_typeof(trace_payload) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_marketpulse_intelligence_action_links_company_source
  ON marketpulse_intelligence_action_links(company_id, source_entity_type, source_entity_id, created_at DESC);

CREATE TABLE IF NOT EXISTS marketpulse_collaboration_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  actor_id UUID NULL,
  previous_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  new_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  governance_flags JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT marketpulse_collaboration_audit_previous_object
    CHECK (jsonb_typeof(previous_state) = 'object'),
  CONSTRAINT marketpulse_collaboration_audit_new_object
    CHECK (jsonb_typeof(new_state) = 'object'),
  CONSTRAINT marketpulse_collaboration_audit_flags_object
    CHECK (jsonb_typeof(governance_flags) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_marketpulse_collaboration_audit_company
  ON marketpulse_collaboration_audit_events(company_id, entity_type, entity_id, created_at DESC);

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'marketpulse_investigation_threads',
    'marketpulse_investigation_comments',
    'marketpulse_entity_acknowledgments',
    'marketpulse_decision_memory',
    'marketpulse_annotations',
    'marketpulse_intelligence_action_links',
    'marketpulse_collaboration_audit_events'
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

DROP TRIGGER IF EXISTS trg_marketpulse_investigation_threads_updated_at ON marketpulse_investigation_threads;
CREATE TRIGGER trg_marketpulse_investigation_threads_updated_at
BEFORE UPDATE ON marketpulse_investigation_threads
FOR EACH ROW EXECUTE FUNCTION omnivyra_touch_updated_at();

DROP TRIGGER IF EXISTS trg_marketpulse_decision_memory_updated_at ON marketpulse_decision_memory;
CREATE TRIGGER trg_marketpulse_decision_memory_updated_at
BEFORE UPDATE ON marketpulse_decision_memory
FOR EACH ROW EXECUTE FUNCTION omnivyra_touch_updated_at();

COMMIT;

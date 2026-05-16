BEGIN;

-- Phase 1B: taxonomy keys, explicit entity/field state, graph-ready
-- relationships, immutable snapshots, and lightweight auditability.

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'company_revenue_segments',
    'company_geographic_exposures',
    'company_dependencies',
    'company_regulatory_exposures',
    'company_workforce_profile',
    'company_technology_dependencies'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS entity_state TEXT NOT NULL DEFAULT ''unknown''', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS field_states JSONB NOT NULL DEFAULT ''{}''::jsonb', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS updated_by UUID NULL', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS update_source TEXT NOT NULL DEFAULT ''manual''', t);
  END LOOP;
END $$;

ALTER TABLE company_revenue_segments
  ADD COLUMN IF NOT EXISTS customer_industry_key TEXT,
  ADD COLUMN IF NOT EXISTS customer_segment_key TEXT,
  ADD COLUMN IF NOT EXISTS geography_key TEXT,
  ADD COLUMN IF NOT EXISTS strategic_priority_key TEXT;

ALTER TABLE company_geographic_exposures
  ADD COLUMN IF NOT EXISTS geography_key TEXT,
  ADD COLUMN IF NOT EXISTS exposure_type_key TEXT,
  ADD COLUMN IF NOT EXISTS criticality_key TEXT;

ALTER TABLE company_dependencies
  ADD COLUMN IF NOT EXISTS dependency_type_key TEXT,
  ADD COLUMN IF NOT EXISTS dependency_region_key TEXT,
  ADD COLUMN IF NOT EXISTS criticality_key TEXT,
  ADD COLUMN IF NOT EXISTS operational_sensitivity_key TEXT;

ALTER TABLE company_regulatory_exposures
  ADD COLUMN IF NOT EXISTS jurisdiction_key TEXT,
  ADD COLUMN IF NOT EXISTS regulation_type_key TEXT,
  ADD COLUMN IF NOT EXISTS severity_key TEXT;

ALTER TABLE company_workforce_profile
  ADD COLUMN IF NOT EXISTS workforce_model_key TEXT,
  ADD COLUMN IF NOT EXISTS contractor_dependency_level_key TEXT,
  ADD COLUMN IF NOT EXISTS immigration_dependency_level_key TEXT,
  ADD COLUMN IF NOT EXISTS labor_sensitivity_level_key TEXT,
  ADD COLUMN IF NOT EXISTS remote_dependency_level_key TEXT;

ALTER TABLE company_technology_dependencies
  ADD COLUMN IF NOT EXISTS provider_category_key TEXT,
  ADD COLUMN IF NOT EXISTS criticality_key TEXT,
  ADD COLUMN IF NOT EXISTS spend_sensitivity_key TEXT;

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'company_revenue_segments',
    'company_geographic_exposures',
    'company_dependencies',
    'company_regulatory_exposures',
    'company_workforce_profile',
    'company_technology_dependencies'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_entity_state_valid');
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I CHECK (entity_state IN (''missing'', ''unknown'', ''inferred'', ''user_confirmed'', ''stale'', ''conflicting'', ''deprecated'', ''system_generated'', ''irrelevant'', ''low_confidence''))',
      t,
      t || '_entity_state_valid'
    );
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_field_states_object');
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I CHECK (jsonb_typeof(field_states) = ''object'')',
      t,
      t || '_field_states_object'
    );
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_review_status_valid');
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I CHECK (review_status IN (''missing'', ''unknown'', ''inferred'', ''user_confirmed'', ''stale'', ''needs_review'', ''conflicting'', ''deprecated'', ''system_generated''))',
      t,
      t || '_review_status_valid'
    );
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS company_context_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source_entity_type TEXT NOT NULL,
  source_entity_id UUID,
  relationship_type TEXT NOT NULL,
  target_entity_type TEXT NOT NULL,
  target_entity_id UUID,
  weight NUMERIC(5,4),
  confidence NUMERIC(4,3),
  source TEXT NOT NULL DEFAULT 'unknown',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT company_context_relationships_type_valid
    CHECK (relationship_type IN ('serves', 'depends_on', 'exposed_to', 'regulated_by', 'competes_with', 'operates_in')),
  CONSTRAINT company_context_relationships_weight_valid
    CHECK (weight IS NULL OR (weight >= 0 AND weight <= 1)),
  CONSTRAINT company_context_relationships_confidence_valid
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  CONSTRAINT company_context_relationships_source_valid
    CHECK (source IN ('user', 'ai_inferred', 'integration', 'import', 'system', 'unknown'))
);

CREATE INDEX IF NOT EXISTS idx_company_context_relationships_company
  ON company_context_relationships(company_id, relationship_type, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_company_context_relationships_source
  ON company_context_relationships(company_id, source_entity_type, source_entity_id);

CREATE INDEX IF NOT EXISTS idx_company_context_relationships_target
  ON company_context_relationships(company_id, target_entity_type, target_entity_id);

CREATE TABLE IF NOT EXISTS company_context_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  snapshot_version INTEGER NOT NULL DEFAULT 1,
  context_payload JSONB NOT NULL,
  readiness_payload JSONB,
  validation_warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by UUID NULL,
  created_for TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT company_context_snapshots_payload_object
    CHECK (jsonb_typeof(context_payload) = 'object'),
  CONSTRAINT company_context_snapshots_warnings_array
    CHECK (jsonb_typeof(validation_warnings) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_company_context_snapshots_company_created
  ON company_context_snapshots(company_id, created_at DESC);

CREATE OR REPLACE FUNCTION prevent_company_context_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'company_context_snapshots are immutable';
END;
$$;

DROP TRIGGER IF EXISTS trg_company_context_snapshots_no_update ON company_context_snapshots;
CREATE TRIGGER trg_company_context_snapshots_no_update
BEFORE UPDATE OR DELETE ON company_context_snapshots
FOR EACH ROW EXECUTE FUNCTION prevent_company_context_snapshot_mutation();

CREATE TABLE IF NOT EXISTS company_context_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  actor_user_id UUID NULL,
  action TEXT NOT NULL,
  update_source TEXT NOT NULL DEFAULT 'manual',
  before_context JSONB,
  after_context JSONB,
  validation_warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT company_context_audit_warnings_array
    CHECK (jsonb_typeof(validation_warnings) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_company_context_audit_company_created
  ON company_context_audit_events(company_id, created_at DESC);

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'company_context_relationships',
    'company_context_snapshots',
    'company_context_audit_events'
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

DROP TRIGGER IF EXISTS trg_company_context_relationships_updated_at ON company_context_relationships;
CREATE TRIGGER trg_company_context_relationships_updated_at
BEFORE UPDATE ON company_context_relationships
FOR EACH ROW EXECUTE FUNCTION omnivyra_touch_updated_at();

COMMIT;

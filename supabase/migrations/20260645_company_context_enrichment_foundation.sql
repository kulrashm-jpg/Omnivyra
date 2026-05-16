BEGIN;

-- Phase 2: enrichment suggestions, inference provenance, review workflow,
-- and downstream-consumable quality metadata. This remains additive and does
-- not change MarketPulse relevance/scoring behavior.

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
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS inference_reason TEXT', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS source_signals JSONB NOT NULL DEFAULT ''[]''::jsonb', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS inference_strength TEXT', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS enrichment_provenance JSONB NOT NULL DEFAULT ''{}''::jsonb', t);

    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_source_signals_array');
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I CHECK (jsonb_typeof(source_signals) = ''array'')',
      t,
      t || '_source_signals_array'
    );

    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_enrichment_provenance_object');
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I CHECK (jsonb_typeof(enrichment_provenance) = ''object'')',
      t,
      t || '_enrichment_provenance_object'
    );

    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_inference_strength_valid');
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I CHECK (inference_strength IS NULL OR inference_strength IN (''weak'', ''strong'', ''conflicting''))',
      t,
      t || '_inference_strength_valid'
    );
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS company_context_enrichment_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  run_type TEXT NOT NULL DEFAULT 'profile_inference',
  status TEXT NOT NULL DEFAULT 'completed',
  source TEXT NOT NULL DEFAULT 'system',
  input_profile JSONB,
  quality_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  suggestions_count INTEGER NOT NULL DEFAULT 0,
  created_by UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT company_context_enrichment_runs_status_valid
    CHECK (status IN ('pending', 'completed', 'failed', 'partial')),
  CONSTRAINT company_context_enrichment_runs_source_valid
    CHECK (source IN ('user', 'ai_inferred', 'integration', 'import', 'system', 'unknown')),
  CONSTRAINT company_context_enrichment_runs_quality_object
    CHECK (jsonb_typeof(quality_payload) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_company_context_enrichment_runs_company_created
  ON company_context_enrichment_runs(company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS company_context_enrichment_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  run_id UUID REFERENCES company_context_enrichment_runs(id) ON DELETE SET NULL,
  target_section TEXT NOT NULL,
  target_entity_type TEXT NOT NULL,
  suggestion_type TEXT NOT NULL DEFAULT 'add_entity',
  payload JSONB NOT NULL,
  confidence NUMERIC(4,3),
  inference_strength TEXT NOT NULL DEFAULT 'weak',
  inference_reason TEXT NOT NULL,
  source_signals JSONB NOT NULL DEFAULT '[]'::jsonb,
  impact_score NUMERIC(5,2) NOT NULL DEFAULT 0,
  readiness_impact_estimate NUMERIC(5,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  review_note TEXT,
  reviewed_by UUID NULL,
  reviewed_at TIMESTAMPTZ,
  snoozed_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT company_context_enrichment_suggestions_type_valid
    CHECK (suggestion_type IN ('add_entity', 'update_entity', 'confirm_entity', 'ask_user')),
  CONSTRAINT company_context_enrichment_suggestions_strength_valid
    CHECK (inference_strength IN ('weak', 'strong', 'conflicting')),
  CONSTRAINT company_context_enrichment_suggestions_status_valid
    CHECK (status IN ('pending', 'accepted', 'rejected', 'modified', 'snoozed', 'expired')),
  CONSTRAINT company_context_enrichment_suggestions_payload_object
    CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT company_context_enrichment_suggestions_signals_array
    CHECK (jsonb_typeof(source_signals) = 'array'),
  CONSTRAINT company_context_enrichment_suggestions_confidence_valid
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1))
);

CREATE INDEX IF NOT EXISTS idx_company_context_enrichment_suggestions_company_status
  ON company_context_enrichment_suggestions(company_id, status, impact_score DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_company_context_enrichment_suggestions_run
  ON company_context_enrichment_suggestions(run_id);

CREATE TABLE IF NOT EXISTS company_context_review_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  suggestion_id UUID REFERENCES company_context_enrichment_suggestions(id) ON DELETE SET NULL,
  actor_user_id UUID NULL,
  action TEXT NOT NULL,
  before_payload JSONB,
  after_payload JSONB,
  quality_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT company_context_review_events_action_valid
    CHECK (action IN ('accepted', 'rejected', 'modified', 'snoozed')),
  CONSTRAINT company_context_review_events_quality_object
    CHECK (jsonb_typeof(quality_payload) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_company_context_review_events_company_created
  ON company_context_review_events(company_id, created_at DESC);

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'company_context_enrichment_runs',
    'company_context_enrichment_suggestions',
    'company_context_review_events'
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

DROP TRIGGER IF EXISTS trg_company_context_enrichment_suggestions_updated_at ON company_context_enrichment_suggestions;
CREATE TRIGGER trg_company_context_enrichment_suggestions_updated_at
BEFORE UPDATE ON company_context_enrichment_suggestions
FOR EACH ROW EXECUTE FUNCTION omnivyra_touch_updated_at();

COMMIT;

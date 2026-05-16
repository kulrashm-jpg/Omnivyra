BEGIN;

-- MarketPulse Phase 7: production hardening, comparative intelligence,
-- opportunity intelligence, assignment accountability, and executive signal
-- optimization. This remains non-predictive and non-autonomous.

ALTER TABLE marketpulse_investigation_threads
  ADD COLUMN IF NOT EXISTS assigned_department TEXT NULL,
  ADD COLUMN IF NOT EXISTS assignment_note TEXT NULL;

CREATE TABLE IF NOT EXISTS marketpulse_assignment_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  thread_id UUID NOT NULL REFERENCES marketpulse_investigation_threads(id) ON DELETE CASCADE,
  previous_assigned_to UUID NULL,
  new_assigned_to UUID NULL,
  previous_department TEXT NULL,
  new_department TEXT NULL,
  changed_by UUID NULL,
  change_reason TEXT,
  governance_flags JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT marketpulse_assignment_history_flags_object
    CHECK (jsonb_typeof(governance_flags) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_marketpulse_assignment_history_thread
  ON marketpulse_assignment_history(thread_id, created_at DESC);

CREATE TABLE IF NOT EXISTS marketpulse_comparative_intelligence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  comparison_type TEXT NOT NULL,
  comparison_subject TEXT NOT NULL,
  baseline_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  current_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  material_change_summary TEXT NOT NULL,
  change_direction TEXT NOT NULL DEFAULT 'stable',
  severity_delta NUMERIC(6,2) NOT NULL DEFAULT 0,
  confidence_delta NUMERIC(6,2) NOT NULL DEFAULT 0,
  evidence_count INTEGER NOT NULL DEFAULT 0,
  confidence NUMERIC(5,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT marketpulse_comparative_type_valid
    CHECK (comparison_type IN ('view', 'pressure_theme', 'lifecycle', 'escalation', 'watchlist', 'investigation')),
  CONSTRAINT marketpulse_comparative_direction_valid
    CHECK (change_direction IN ('worsening', 'improving', 'stable', 'emerging', 'decaying')),
  CONSTRAINT marketpulse_comparative_baseline_object
    CHECK (jsonb_typeof(baseline_payload) = 'object'),
  CONSTRAINT marketpulse_comparative_current_object
    CHECK (jsonb_typeof(current_payload) = 'object'),
  CONSTRAINT marketpulse_comparative_confidence_valid
    CHECK (confidence BETWEEN 0 AND 100)
);

CREATE INDEX IF NOT EXISTS idx_marketpulse_comparative_company
  ON marketpulse_comparative_intelligence(company_id, comparison_type, updated_at DESC);

CREATE TABLE IF NOT EXISTS marketpulse_opportunity_intelligence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  opportunity_type TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  source_entity_type TEXT NOT NULL,
  source_entity_id UUID NOT NULL,
  opportunity_direction TEXT NOT NULL DEFAULT 'positive',
  materiality_level TEXT NOT NULL DEFAULT 'moderate',
  confidence NUMERIC(5,2) NOT NULL DEFAULT 0,
  supporting_evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  watchlist_alignment JSONB NOT NULL DEFAULT '{}'::jsonb,
  lifecycle_state TEXT NOT NULL DEFAULT 'new',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT marketpulse_opportunity_type_valid
    CHECK (opportunity_type IN ('market_opening', 'competitive_gap', 'cost_relief', 'regulatory_clarity', 'talent_window', 'technology_advantage', 'funding_tailwind', 'customer_demand')),
  CONSTRAINT marketpulse_opportunity_direction_valid
    CHECK (opportunity_direction IN ('positive', 'mixed', 'watch')),
  CONSTRAINT marketpulse_opportunity_materiality_valid
    CHECK (materiality_level IN ('informational', 'moderate', 'significant', 'strategic')),
  CONSTRAINT marketpulse_opportunity_evidence_object
    CHECK (jsonb_typeof(supporting_evidence) = 'object'),
  CONSTRAINT marketpulse_opportunity_watchlist_object
    CHECK (jsonb_typeof(watchlist_alignment) = 'object'),
  CONSTRAINT marketpulse_opportunity_confidence_valid
    CHECK (confidence BETWEEN 0 AND 100)
);

CREATE INDEX IF NOT EXISTS idx_marketpulse_opportunity_company
  ON marketpulse_opportunity_intelligence(company_id, materiality_level, confidence DESC, updated_at DESC);

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'marketpulse_assignment_history',
    'marketpulse_comparative_intelligence',
    'marketpulse_opportunity_intelligence'
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

DROP TRIGGER IF EXISTS trg_marketpulse_comparative_updated_at ON marketpulse_comparative_intelligence;
CREATE TRIGGER trg_marketpulse_comparative_updated_at
BEFORE UPDATE ON marketpulse_comparative_intelligence
FOR EACH ROW EXECUTE FUNCTION omnivyra_touch_updated_at();

DROP TRIGGER IF EXISTS trg_marketpulse_opportunity_updated_at ON marketpulse_opportunity_intelligence;
CREATE TRIGGER trg_marketpulse_opportunity_updated_at
BEFORE UPDATE ON marketpulse_opportunity_intelligence
FOR EACH ROW EXECUTE FUNCTION omnivyra_touch_updated_at();

COMMIT;

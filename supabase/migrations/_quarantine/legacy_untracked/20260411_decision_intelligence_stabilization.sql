BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'decision_objects'
  ) THEN
    RAISE EXCEPTION 'Missing prerequisite table "decision_objects". Run 20260409_canonical_intelligence_model.sql and 20260410_decision_object_enforcement.sql before 20260411_decision_intelligence_stabilization.sql.';
  END IF;
END $$;

ALTER TABLE decision_objects
  ADD COLUMN IF NOT EXISTS last_changed_by TEXT NOT NULL DEFAULT 'system',
  ADD COLUMN IF NOT EXISTS priority_score SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS effort_score SMALLINT NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'decision_objects'
      AND column_name = 'execution_score'
  ) THEN
    ALTER TABLE decision_objects
      ADD COLUMN execution_score NUMERIC(12,4)
      GENERATED ALWAYS AS ((impact_revenue * confidence_score) / GREATEST(effort_score, 1)) STORED;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_decision_objects_company_execution
  ON decision_objects(company_id, report_tier, status, execution_score DESC, priority_score DESC, impact_revenue DESC);

ALTER TABLE decision_objects
  DROP CONSTRAINT IF EXISTS decision_objects_entity_type_valid;

ALTER TABLE decision_objects
  ADD CONSTRAINT decision_objects_entity_type_valid
  CHECK (entity_type IN ('page', 'session', 'campaign', 'lead', 'revenue_event', 'keyword', 'content_cluster', 'global'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'decision_objects_priority_score_valid'
  ) THEN
    ALTER TABLE decision_objects
      ADD CONSTRAINT decision_objects_priority_score_valid
      CHECK (priority_score BETWEEN 0 AND 100);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'decision_objects_effort_score_valid'
  ) THEN
    ALTER TABLE decision_objects
      ADD CONSTRAINT decision_objects_effort_score_valid
      CHECK (effort_score BETWEEN 0 AND 100);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'decision_objects_last_changed_by_valid'
  ) THEN
    ALTER TABLE decision_objects
      ADD CONSTRAINT decision_objects_last_changed_by_valid
      CHECK (last_changed_by IN ('system', 'user'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS action_registry (
  action_type              TEXT        PRIMARY KEY,
  handler_key              TEXT        NOT NULL,
  required_payload_fields  TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
  is_active                BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT action_registry_action_type_not_blank
    CHECK (LENGTH(BTRIM(action_type)) > 0),
  CONSTRAINT action_registry_handler_key_not_blank
    CHECK (LENGTH(BTRIM(handler_key)) > 0)
);

DROP TRIGGER IF EXISTS trg_action_registry_updated_at ON action_registry;
CREATE TRIGGER trg_action_registry_updated_at
  BEFORE UPDATE ON action_registry
  FOR EACH ROW
  EXECUTE FUNCTION omnivyra_touch_updated_at();

INSERT INTO action_registry (action_type, handler_key, required_payload_fields, is_active)
VALUES
  ('fix_cta', 'CTAService.execute', ARRAY['campaign_id'], TRUE),
  ('improve_content', 'ContentService.generate', ARRAY[]::TEXT[], TRUE),
  ('reallocate_budget', 'AdsService.adjust', ARRAY['campaign_id'], TRUE),
  ('launch_campaign', 'CampaignService.launch', ARRAY[]::TEXT[], TRUE),
  ('fix_distribution', 'DistributionService.repair', ARRAY[]::TEXT[], TRUE),
  ('capture_leads', 'LeadService.capture', ARRAY['opportunity_type'], TRUE),
  ('improve_tracking', 'TrackingService.audit', ARRAY['campaign_id'], TRUE),
  ('adjust_strategy', 'StrategyService.adjust', ARRAY['campaign_id'], TRUE),
  ('apply_learning', 'LearningService.apply', ARRAY['campaign_id'], TRUE)
ON CONFLICT (action_type) DO UPDATE
SET
  handler_key = EXCLUDED.handler_key,
  required_payload_fields = EXCLUDED.required_payload_fields,
  is_active = EXCLUDED.is_active;

CREATE TABLE IF NOT EXISTS decision_events (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id    UUID        NOT NULL REFERENCES decision_objects(id) ON DELETE CASCADE,
  event_type     TEXT        NOT NULL,
  previous_value JSONB,
  new_value      JSONB,
  changed_by     TEXT        NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT decision_events_event_type_valid
    CHECK (event_type IN ('created', 'updated', 'resolved', 'reopened')),
  CONSTRAINT decision_events_changed_by_valid
    CHECK (changed_by IN ('system', 'user'))
);

CREATE INDEX IF NOT EXISTS idx_decision_events_decision_created
  ON decision_events(decision_id, created_at DESC);

CREATE TABLE IF NOT EXISTS data_source_status (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source         TEXT        NOT NULL,
  status         TEXT        NOT NULL,
  last_synced_at TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT data_source_status_source_valid
    CHECK (source IN ('crawler', 'ga', 'gsc', 'crm', 'ads')),
  CONSTRAINT data_source_status_status_valid
    CHECK (status IN ('connected', 'syncing', 'error', 'missing')),
  CONSTRAINT data_source_status_company_source_unique
    UNIQUE (company_id, source)
);

CREATE INDEX IF NOT EXISTS idx_data_source_status_company_status
  ON data_source_status(company_id, status, last_synced_at DESC);

DROP TRIGGER IF EXISTS trg_data_source_status_updated_at ON data_source_status;
CREATE TRIGGER trg_data_source_status_updated_at
  BEFORE UPDATE ON data_source_status
  FOR EACH ROW
  EXECUTE FUNCTION omnivyra_touch_updated_at();

CREATE OR REPLACE FUNCTION omnivyra_validate_decision_action()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  required_fields TEXT[];
  required_field  TEXT;
BEGIN
  SELECT ar.required_payload_fields
  INTO required_fields
  FROM action_registry ar
  WHERE ar.action_type = NEW.action_type
    AND ar.is_active = TRUE;

  IF required_fields IS NULL THEN
    RAISE EXCEPTION 'Decision action_type % is not registered or inactive', NEW.action_type;
  END IF;

  FOREACH required_field IN ARRAY required_fields LOOP
    IF jsonb_typeof(NEW.action_payload) <> 'object' OR NOT (NEW.action_payload ? required_field) THEN
      RAISE EXCEPTION 'Decision action_payload missing required field % for action_type %', required_field, NEW.action_type;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION omnivyra_prevent_decision_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'decision_objects are immutable and cannot be deleted';
END;
$$;

CREATE OR REPLACE FUNCTION omnivyra_prevent_decision_overwrite()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(OLD.company_id, OLD.entity_type, OLD.entity_id, OLD.issue_type, OLD.title, OLD.description, OLD.evidence,
         OLD.impact_traffic, OLD.impact_conversion, OLD.impact_revenue, OLD.confidence_score, OLD.recommendation,
         OLD.action_type, OLD.action_payload, OLD.report_tier, OLD.source_service)
     IS DISTINCT FROM
     ROW(NEW.company_id, NEW.entity_type, NEW.entity_id, NEW.issue_type, NEW.title, NEW.description, NEW.evidence,
         NEW.impact_traffic, NEW.impact_conversion, NEW.impact_revenue, NEW.confidence_score, NEW.recommendation,
         NEW.action_type, NEW.action_payload, NEW.report_tier, NEW.source_service) THEN
    RAISE EXCEPTION 'Decision core fields are immutable. Create a new decision object instead of overwriting.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION omnivyra_log_decision_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  detected_event_type TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO decision_events (decision_id, event_type, previous_value, new_value, changed_by)
    VALUES (NEW.id, 'created', NULL, to_jsonb(NEW), COALESCE(NEW.last_changed_by, 'system'));
    RETURN NEW;
  END IF;

  detected_event_type := 'updated';
  IF OLD.status <> 'resolved' AND NEW.status = 'resolved' THEN
    detected_event_type := 'resolved';
  ELSIF OLD.status IN ('resolved', 'ignored') AND NEW.status = 'open' THEN
    detected_event_type := 'reopened';
  END IF;

  INSERT INTO decision_events (decision_id, event_type, previous_value, new_value, changed_by)
  VALUES (NEW.id, detected_event_type, to_jsonb(OLD), to_jsonb(NEW), COALESCE(NEW.last_changed_by, 'system'));

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_decision_objects_validate_action ON decision_objects;
CREATE TRIGGER trg_decision_objects_validate_action
  BEFORE INSERT OR UPDATE ON decision_objects
  FOR EACH ROW
  EXECUTE FUNCTION omnivyra_validate_decision_action();

DROP TRIGGER IF EXISTS trg_decision_objects_prevent_overwrite ON decision_objects;
CREATE TRIGGER trg_decision_objects_prevent_overwrite
  BEFORE UPDATE ON decision_objects
  FOR EACH ROW
  EXECUTE FUNCTION omnivyra_prevent_decision_overwrite();

DROP TRIGGER IF EXISTS trg_decision_objects_log_events ON decision_objects;
CREATE TRIGGER trg_decision_objects_log_events
  AFTER INSERT OR UPDATE ON decision_objects
  FOR EACH ROW
  EXECUTE FUNCTION omnivyra_log_decision_event();

DROP TRIGGER IF EXISTS trg_decision_objects_no_delete ON decision_objects;
CREATE TRIGGER trg_decision_objects_no_delete
  BEFORE DELETE ON decision_objects
  FOR EACH ROW
  EXECUTE FUNCTION omnivyra_prevent_decision_delete();

CREATE OR REPLACE VIEW snapshot_view AS
SELECT *
FROM decision_objects
WHERE report_tier = 'snapshot';

CREATE OR REPLACE VIEW growth_view AS
SELECT *
FROM decision_objects
WHERE report_tier = 'growth';

CREATE OR REPLACE VIEW deep_view AS
SELECT *
FROM decision_objects
WHERE report_tier = 'deep';

ALTER TABLE action_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_source_status ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t TEXT;
  protected_tables TEXT[] := ARRAY[
    'action_registry',
    'decision_events',
    'data_source_status'
  ];
BEGIN
  FOREACH t IN ARRAY protected_tables LOOP
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

COMMIT;

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'decision_objects'
  ) THEN
    RAISE EXCEPTION 'Missing prerequisite table "decision_objects". Run 20260409_canonical_intelligence_model.sql before 20260410_decision_object_enforcement.sql.';
  END IF;
END $$;

ALTER TABLE decision_objects
  ADD COLUMN IF NOT EXISTS report_tier TEXT,
  ADD COLUMN IF NOT EXISTS source_service TEXT,
  ADD COLUMN IF NOT EXISTS action_payload JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE decision_objects
SET
  report_tier = COALESCE(report_tier, 'growth'),
  source_service = COALESCE(source_service, 'legacy_migration')
WHERE report_tier IS NULL
   OR source_service IS NULL;

ALTER TABLE decision_objects
  ALTER COLUMN report_tier SET NOT NULL,
  ALTER COLUMN source_service SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'decision_objects_report_tier_valid'
  ) THEN
    ALTER TABLE decision_objects
      ADD CONSTRAINT decision_objects_report_tier_valid
      CHECK (report_tier IN ('snapshot', 'growth', 'deep'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'decision_objects_source_service_not_blank'
  ) THEN
    ALTER TABLE decision_objects
      ADD CONSTRAINT decision_objects_source_service_not_blank
      CHECK (LENGTH(BTRIM(source_service)) > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'decision_objects_action_payload_shape'
  ) THEN
    ALTER TABLE decision_objects
      ADD CONSTRAINT decision_objects_action_payload_shape
      CHECK (jsonb_typeof(action_payload) IN ('object', 'array'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_decision_objects_company_tier_created
  ON decision_objects(company_id, report_tier, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_decision_objects_company_source_created
  ON decision_objects(company_id, source_service, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_decision_objects_action_payload_gin
  ON decision_objects
  USING GIN(action_payload);

COMMENT ON COLUMN decision_objects.report_tier IS
  'Canonical report tier this decision belongs to: snapshot, growth, or deep.';

COMMENT ON COLUMN decision_objects.source_service IS
  'Backend service that generated the decision object. Used for enforcement, refresh, and tracing.';

COMMENT ON COLUMN decision_objects.action_payload IS
  'Structured execution payload consumed by activation flows. Must exist for every decision object.';

COMMIT;

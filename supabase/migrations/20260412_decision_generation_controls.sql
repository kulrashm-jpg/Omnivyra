BEGIN;

CREATE TABLE IF NOT EXISTS decision_generation_controls (
  company_id                    UUID        PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  min_refresh_interval_minutes  INTEGER     NOT NULL DEFAULT 60,
  max_generations_per_hour      INTEGER     NOT NULL DEFAULT 12,
  last_generation_at            TIMESTAMPTZ,
  generation_window_started_at  TIMESTAMPTZ,
  generation_count_in_window    INTEGER     NOT NULL DEFAULT 0,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT decision_generation_controls_min_refresh_valid
    CHECK (min_refresh_interval_minutes >= 1),
  CONSTRAINT decision_generation_controls_max_per_hour_valid
    CHECK (max_generations_per_hour >= 1),
  CONSTRAINT decision_generation_controls_window_count_valid
    CHECK (generation_count_in_window >= 0)
);

DROP TRIGGER IF EXISTS trg_decision_generation_controls_updated_at ON decision_generation_controls;
CREATE TRIGGER trg_decision_generation_controls_updated_at
  BEFORE UPDATE ON decision_generation_controls
  FOR EACH ROW
  EXECUTE FUNCTION omnivyra_touch_updated_at();

CREATE INDEX IF NOT EXISTS idx_decision_generation_controls_last_generation
  ON decision_generation_controls(last_generation_at DESC);

ALTER TABLE decision_generation_controls ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'decision_generation_controls'
      AND policyname = 'service_role_full_access'
  ) THEN
    DROP POLICY "service_role_full_access" ON public.decision_generation_controls;
  END IF;

  CREATE POLICY "service_role_full_access"
    ON public.decision_generation_controls
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
END $$;

COMMIT;

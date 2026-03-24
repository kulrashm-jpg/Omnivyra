-- ── Cost tracking columns on intelligence_execution_log ───────────────────────
ALTER TABLE intelligence_execution_log
  ADD COLUMN IF NOT EXISTS input_tokens       INTEGER,
  ADD COLUMN IF NOT EXISTS output_tokens      INTEGER,
  ADD COLUMN IF NOT EXISTS estimated_cost_usd NUMERIC(12, 8);

-- Index for cost aggregation queries
CREATE INDEX IF NOT EXISTS iel_cost_job_started_idx
  ON intelligence_execution_log (job_type, started_at)
  WHERE estimated_cost_usd IS NOT NULL;

-- ── System throttle config (singleton row, id = 1) ─────────────────────────────
CREATE TABLE IF NOT EXISTS intelligence_throttle_config (
  id                       INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),

  -- CPU load average thresholds (1-minute load / cpu_count × 100 = %)
  cpu_medium_threshold     NUMERIC(5, 2) NOT NULL DEFAULT 70.0,  -- pause P7-P10
  cpu_high_threshold       NUMERIC(5, 2) NOT NULL DEFAULT 85.0,  -- pause P4-P10

  -- Concurrent running job count thresholds
  queue_medium_threshold   INTEGER       NOT NULL DEFAULT 6,     -- pause P7-P10
  queue_high_threshold     INTEGER       NOT NULL DEFAULT 12,    -- pause P4-P10

  -- Master on/off switch
  enabled                  BOOLEAN       NOT NULL DEFAULT true,

  updated_at               TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_by               TEXT          NOT NULL DEFAULT 'system'
);

-- Seed the singleton row
INSERT INTO intelligence_throttle_config DEFAULT VALUES
  ON CONFLICT (id) DO NOTHING;

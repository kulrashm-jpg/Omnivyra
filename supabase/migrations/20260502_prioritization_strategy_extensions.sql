BEGIN;

ALTER TABLE decision_priority_queue
  ADD COLUMN IF NOT EXISTS priority_rationale TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS priority_segment TEXT NOT NULL DEFAULT 'strategic',
  ADD COLUMN IF NOT EXISTS prioritization_mode TEXT NOT NULL DEFAULT 'growth',
  ADD COLUMN IF NOT EXISTS correlation_boost NUMERIC(6,4) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'decision_priority_queue_priority_segment_valid'
  ) THEN
    ALTER TABLE decision_priority_queue
      ADD CONSTRAINT decision_priority_queue_priority_segment_valid
      CHECK (priority_segment IN ('quick_wins', 'strategic', 'risk'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'decision_priority_queue_prioritization_mode_valid'
  ) THEN
    ALTER TABLE decision_priority_queue
      ADD CONSTRAINT decision_priority_queue_prioritization_mode_valid
      CHECK (prioritization_mode IN ('growth', 'efficiency', 'risk'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'decision_priority_queue_correlation_boost_valid'
  ) THEN
    ALTER TABLE decision_priority_queue
      ADD CONSTRAINT decision_priority_queue_correlation_boost_valid
      CHECK (correlation_boost BETWEEN 0 AND 1);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_decision_priority_queue_company_mode_rank
  ON decision_priority_queue(company_id, prioritization_mode, priority_rank ASC);

CREATE INDEX IF NOT EXISTS idx_decision_priority_queue_company_segment_rank
  ON decision_priority_queue(company_id, priority_segment, priority_rank ASC);

COMMENT ON COLUMN decision_priority_queue.priority_rationale IS
  'Human-readable rationale explaining the top ranking factors for this decision.';

COMMENT ON COLUMN decision_priority_queue.priority_segment IS
  'Strategic segment bucket: quick_wins, strategic, or risk.';

COMMENT ON COLUMN decision_priority_queue.prioritization_mode IS
  'Weight profile used for scoring: growth, efficiency, or risk.';

COMMENT ON COLUMN decision_priority_queue.correlation_boost IS
  'Normalized boost from cross-decision correlation signals (0..1).';

COMMIT;

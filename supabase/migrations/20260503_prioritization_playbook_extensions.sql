BEGIN;

ALTER TABLE decision_priority_queue
  ADD COLUMN IF NOT EXISTS playbook_json JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'decision_priority_queue_playbook_json_shape'
  ) THEN
    ALTER TABLE decision_priority_queue
      ADD CONSTRAINT decision_priority_queue_playbook_json_shape
      CHECK (
        jsonb_typeof(playbook_json) = 'object'
        AND playbook_json ? 'objective'
        AND playbook_json ? 'steps'
        AND playbook_json ? 'estimated_effort'
        AND playbook_json ? 'expected_impact'
        AND playbook_json ? 'dependencies'
        AND jsonb_typeof(playbook_json -> 'steps') = 'array'
        AND jsonb_typeof(playbook_json -> 'expected_impact') = 'object'
        AND jsonb_typeof(playbook_json -> 'dependencies') = 'array'
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_decision_priority_queue_playbook_gin
  ON decision_priority_queue
  USING gin (playbook_json jsonb_path_ops);

COMMENT ON COLUMN decision_priority_queue.playbook_json IS
  'Deterministic execution playbook generated from a prioritized decision.';

COMMIT;

-- =====================================================
-- WORKER DEAD LETTER QUEUE
-- Fault-tolerant worker reliability: permanently failed jobs.
-- =====================================================

CREATE TABLE IF NOT EXISTS worker_dead_letter_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_name TEXT NOT NULL,
  job_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  failure_reason TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 1,
  last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dead_letter_worker
  ON worker_dead_letter_queue (worker_name);

CREATE INDEX IF NOT EXISTS idx_dead_letter_created
  ON worker_dead_letter_queue (created_at DESC);

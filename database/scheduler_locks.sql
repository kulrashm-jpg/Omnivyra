-- scheduler_locks
-- Prevents overlapping runs of scheduled jobs

CREATE TABLE IF NOT EXISTS scheduler_locks (
  job_name TEXT PRIMARY KEY,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

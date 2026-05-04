CREATE TABLE IF NOT EXISTS job_idempotency_keys (
  key TEXT PRIMARY KEY,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_idempotency_keys_expires_at
  ON job_idempotency_keys (expires_at);

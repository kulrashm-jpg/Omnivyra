-- Reconstructed by Phase B0 on 2026-05-03
-- Source: supabase_migrations.schema_migrations (canonical, applied via supabase db push)
-- Version: 20260421212530  Name: email_jobs_idempotency_columns
-- Idempotency: GUARDED (DROP CONSTRAINT IF EXISTS, ADD COLUMN IF NOT EXISTS, CREATE UNIQUE INDEX IF NOT EXISTS).

ALTER TABLE email_jobs
  DROP CONSTRAINT IF EXISTS email_jobs_status_check;

ALTER TABLE email_jobs
  ADD CONSTRAINT email_jobs_status_check
  CHECK (status IN ('pending', 'processing', 'failed', 'sent', 'dead'));

ALTER TABLE email_jobs
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS payload_hash TEXT,
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS locked_by TEXT,
  ADD COLUMN IF NOT EXISTS request_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS email_jobs_idempotency_key_unique
  ON email_jobs (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS email_jobs_pending_payload_unique
  ON email_jobs (LOWER(recipient_email), job_type, payload_hash)
  WHERE status IN ('pending', 'processing', 'failed');

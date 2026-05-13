-- ─────────────────────────────────────────────────────────────────────────────
-- 20260639_email_jobs_async_invite_pipeline.sql
--
-- Phase 2.A.1 — async invite delivery + queue reliability + delivery audit.
--
-- Changes:
--   1. email_jobs gains structured-payload columns (template_key, payload,
--      payload_encrypted, invitation_id, correlation_id, max_retries,
--      dead_lettered_at). subject/html become NULLABLE so new-style rows
--      do NOT pre-render.
--   2. email_jobs.job_type CHECK extended for the two new invite types.
--   3. claim_email_jobs() RPC replaced — returns the new columns AND uses
--      the per-row max_retries (was hard-coded to 3) plus a dead-letter gate.
--   4. finalize_email_job() RPC — atomically updates status + writes
--      email_events row. The worker only calls this — never raw UPDATEs.
--   5. email_events table — append-only delivery audit. Single row per
--      lifecycle transition (queued / claimed / sending / sent / failed /
--      retried / dead_lettered).
--
-- Safe to run twice (IF NOT EXISTS / DROP IF EXISTS).
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. email_jobs — new columns + relax subject/html NOT NULL
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE email_jobs
  ADD COLUMN IF NOT EXISTS template_key       TEXT,
  ADD COLUMN IF NOT EXISTS payload            JSONB,
  ADD COLUMN IF NOT EXISTS payload_encrypted  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS invitation_id      UUID REFERENCES invitations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS correlation_id     TEXT,
  ADD COLUMN IF NOT EXISTS max_retries        INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS dead_lettered_at   TIMESTAMPTZ;

-- Old rows were pre-rendered; new rows ship structured payload only.
ALTER TABLE email_jobs ALTER COLUMN subject DROP NOT NULL;
ALTER TABLE email_jobs ALTER COLUMN html    DROP NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Extend job_type CHECK with the new invite types
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE email_jobs DROP CONSTRAINT IF EXISTS email_jobs_job_type_check;

ALTER TABLE email_jobs
  ADD CONSTRAINT email_jobs_job_type_check
  CHECK (job_type IN (
    'magic_link',
    'invite',
    'reset',
    'company_referral',
    'inbound_signup_notice',
    'team_invite_magic_link',
    'team_invite_credentials'
  ));

CREATE INDEX IF NOT EXISTS idx_email_jobs_invitation_id
  ON email_jobs (invitation_id)
  WHERE invitation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_jobs_correlation_id
  ON email_jobs (correlation_id)
  WHERE correlation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_jobs_due
  ON email_jobs (status, next_attempt_at)
  WHERE status IN ('pending', 'failed');

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. email_events — append-only delivery audit
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS email_events (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id               UUID         NOT NULL REFERENCES email_jobs(id) ON DELETE CASCADE,
  invitation_id        UUID         REFERENCES invitations(id) ON DELETE SET NULL,
  recipient_email      TEXT         NOT NULL,
  template_key         TEXT,
  event_type           TEXT         NOT NULL
    CHECK (event_type IN (
      'queued',
      'claimed',
      'sending',
      'sent',
      'failed',
      'retried',
      'dead_lettered'
    )),
  provider_message_id  TEXT,
  failure_reason       TEXT,
  retry_count          INTEGER      NOT NULL DEFAULT 0,
  correlation_id       TEXT,
  metadata             JSONB,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE email_events IS
  'Append-only delivery audit for email_jobs. NEVER stores message body or '
  'temporary credentials — those live in email_jobs.payload (encrypted when '
  'payload_encrypted=true). Each lifecycle transition writes one row.';

CREATE INDEX IF NOT EXISTS idx_email_events_job_id
  ON email_events (job_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_events_invitation_id
  ON email_events (invitation_id, created_at DESC)
  WHERE invitation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_events_recipient_recent
  ON email_events (LOWER(recipient_email), created_at DESC);

ALTER TABLE email_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full_access" ON email_events;
CREATE POLICY "service_role_full_access" ON email_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. claim_email_jobs — replaced to honor per-row max_retries +
--    dead_lettered_at + return the new structured columns
-- ═══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS claim_email_jobs(TEXT, INTEGER);

CREATE OR REPLACE FUNCTION claim_email_jobs(
  p_worker_id TEXT,
  p_limit     INTEGER DEFAULT 20
)
RETURNS TABLE (
  id                 UUID,
  job_type           TEXT,
  template_key       TEXT,
  payload            JSONB,
  payload_encrypted  BOOLEAN,
  recipient_email    TEXT,
  subject            TEXT,
  html               TEXT,
  retry_count        INTEGER,
  max_retries        INTEGER,
  invitation_id      UUID,
  correlation_id     TEXT,
  idempotency_key    TEXT,
  payload_hash       TEXT,
  request_id         TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT ej.id
    FROM email_jobs ej
    WHERE ej.status IN ('pending', 'failed')
      AND COALESCE(ej.next_attempt_at, ej.created_at) <= NOW()
      AND ej.retry_count < ej.max_retries
      AND ej.dead_lettered_at IS NULL
      AND (ej.locked_at IS NULL OR ej.locked_at < NOW() - INTERVAL '5 minutes')
    ORDER BY ej.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE email_jobs ej
  SET status     = 'processing',
      locked_at  = NOW(),
      locked_by  = p_worker_id,
      updated_at = NOW()
  FROM picked
  WHERE ej.id = picked.id
  RETURNING
    ej.id,
    ej.job_type,
    ej.template_key,
    ej.payload,
    ej.payload_encrypted,
    ej.recipient_email,
    ej.subject,
    ej.html,
    ej.retry_count,
    ej.max_retries,
    ej.invitation_id,
    ej.correlation_id,
    ej.idempotency_key,
    ej.payload_hash,
    ej.request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION claim_email_jobs(TEXT, INTEGER) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. finalize_email_job — atomic terminal/transient state update + event
-- ═══════════════════════════════════════════════════════════════════════════
--
-- p_status:
--   'sent'   — terminal success. Sets sent_at, clears lock. Writes 'sent' event.
--   'failed' — transient failure. Increments retry_count, sets next_attempt_at,
--              clears lock. Writes 'failed' event. Caller picks the backoff.
--   'dead'   — terminal failure. Sets dead_lettered_at, increments retry_count,
--              clears lock. Writes 'dead_lettered' event.
--
-- The job stays under FOR UPDATE for the whole transaction.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION finalize_email_job(
  p_job_id              UUID,
  p_status              TEXT,                        -- 'sent' | 'failed' | 'dead'
  p_error               TEXT        DEFAULT NULL,
  p_provider_message_id TEXT        DEFAULT NULL,
  p_next_attempt_at     TIMESTAMPTZ DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_job        email_jobs%ROWTYPE;
  v_event_type TEXT;
  v_new_retry  INTEGER;
BEGIN
  SELECT * INTO v_job FROM email_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'EMAIL_JOB_NOT_FOUND';
  END IF;

  IF p_status = 'sent' THEN
    v_new_retry := v_job.retry_count;
    v_event_type := 'sent';
    UPDATE email_jobs
      SET status          = 'sent',
          sent_at         = NOW(),
          last_error      = NULL,
          last_attempt_at = NOW(),
          locked_at       = NULL,
          locked_by       = NULL,
          updated_at      = NOW()
      WHERE id = p_job_id;

  ELSIF p_status = 'failed' THEN
    v_new_retry := v_job.retry_count + 1;
    v_event_type := 'failed';
    UPDATE email_jobs
      SET status          = 'failed',
          last_error      = p_error,
          retry_count     = v_new_retry,
          next_attempt_at = p_next_attempt_at,
          last_attempt_at = NOW(),
          locked_at       = NULL,
          locked_by       = NULL,
          updated_at      = NOW()
      WHERE id = p_job_id;

  ELSIF p_status = 'dead' THEN
    v_new_retry := v_job.retry_count + 1;
    v_event_type := 'dead_lettered';
    UPDATE email_jobs
      SET status            = 'dead',
          dead_lettered_at  = NOW(),
          last_error        = p_error,
          retry_count       = v_new_retry,
          last_attempt_at   = NOW(),
          locked_at         = NULL,
          locked_by         = NULL,
          updated_at        = NOW()
      WHERE id = p_job_id;

  ELSE
    RAISE EXCEPTION 'INVALID_FINALIZE_STATUS:%', p_status;
  END IF;

  INSERT INTO email_events (
    job_id,
    invitation_id,
    recipient_email,
    template_key,
    event_type,
    provider_message_id,
    failure_reason,
    retry_count,
    correlation_id
  ) VALUES (
    p_job_id,
    v_job.invitation_id,
    v_job.recipient_email,
    v_job.template_key,
    v_event_type,
    p_provider_message_id,
    p_error,
    v_new_retry,
    v_job.correlation_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION finalize_email_job(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. record_email_event — used by API/worker for non-terminal events
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION record_email_event(
  p_job_id        UUID,
  p_event_type    TEXT,
  p_metadata      JSONB DEFAULT NULL,
  p_failure_reason TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_job email_jobs%ROWTYPE;
BEGIN
  SELECT * INTO v_job FROM email_jobs WHERE id = p_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'EMAIL_JOB_NOT_FOUND';
  END IF;

  INSERT INTO email_events (
    job_id,
    invitation_id,
    recipient_email,
    template_key,
    event_type,
    failure_reason,
    retry_count,
    correlation_id,
    metadata
  ) VALUES (
    p_job_id,
    v_job.invitation_id,
    v_job.recipient_email,
    v_job.template_key,
    p_event_type,
    p_failure_reason,
    v_job.retry_count,
    v_job.correlation_id,
    p_metadata
  );
END;
$$;

GRANT EXECUTE ON FUNCTION record_email_event(UUID, TEXT, JSONB, TEXT) TO service_role;

COMMIT;

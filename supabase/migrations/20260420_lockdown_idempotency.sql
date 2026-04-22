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

ALTER TABLE invitations
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS invitations_idempotency_key_unique
  ON invitations (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS invitations_token_hash_unique
  ON invitations (token_hash);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invitations_token_consumed_acceptance_ck'
  ) THEN
    ALTER TABLE invitations
      ADD CONSTRAINT invitations_token_consumed_acceptance_ck
      CHECK (
        accepted_at IS NULL
        OR token_consumed_at IS NOT NULL
      );
  END IF;
END $$;

ALTER TABLE super_admin_audit_logs
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS super_admin_audit_logs_idempotency_key_unique
  ON super_admin_audit_logs (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE manual_credit_grants
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS manual_credit_grants_idempotency_key_unique
  ON manual_credit_grants (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS credit_transactions_idempotency_key_lockdown_unique
  ON credit_transactions (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS api_idempotency_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processing', 'completed', 'failed')),
  request_id TEXT,
  locked_at TIMESTAMPTZ,
  response_status INTEGER,
  response_body JSONB,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (scope, idempotency_key)
);

CREATE OR REPLACE FUNCTION claim_email_jobs(
  p_worker_id TEXT,
  p_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
  id UUID,
  job_type TEXT,
  recipient_email TEXT,
  subject TEXT,
  html TEXT,
  retry_count INTEGER,
  idempotency_key TEXT,
  payload_hash TEXT,
  request_id TEXT
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
      AND ej.retry_count < 3
      AND (ej.locked_at IS NULL OR ej.locked_at < NOW() - INTERVAL '5 minutes')
    ORDER BY ej.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE email_jobs ej
  SET status = 'processing',
      locked_at = NOW(),
      locked_by = p_worker_id,
      updated_at = NOW()
  FROM picked
  WHERE ej.id = picked.id
  RETURNING
    ej.id,
    ej.job_type,
    ej.recipient_email,
    ej.subject,
    ej.html,
    ej.retry_count,
    ej.idempotency_key,
    ej.payload_hash,
    ej.request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION claim_email_jobs(TEXT, INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION activate_invitation_membership(
  p_invitation_id UUID,
  p_user_id UUID,
  p_now TIMESTAMPTZ DEFAULT NOW()
)
RETURNS TABLE (
  invitation_id UUID,
  company_id UUID,
  role TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_invitation invitations%ROWTYPE;
BEGIN
  SELECT *
  INTO v_invitation
  FROM invitations
  WHERE id = p_invitation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVITATION_NOT_FOUND';
  END IF;

  IF v_invitation.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'INVITATION_REVOKED';
  END IF;

  IF v_invitation.expires_at <= p_now THEN
    UPDATE invitations
    SET revoked_at = COALESCE(revoked_at, p_now)
    WHERE id = p_invitation_id;
    RAISE EXCEPTION 'INVITATION_EXPIRED';
  END IF;

  IF v_invitation.token_consumed_at IS NULL THEN
    RAISE EXCEPTION 'INVITATION_NOT_CONSUMED';
  END IF;

  IF v_invitation.accepted_at IS NULL THEN
    UPDATE invitations
    SET accepted_at = p_now,
        accepted_by = p_user_id
    WHERE id = p_invitation_id;
  END IF;

  INSERT INTO user_company_roles (
    user_id,
    company_id,
    role,
    status,
    join_source,
    accepted_at,
    created_at,
    updated_at
  )
  VALUES (
    p_user_id,
    v_invitation.company_id,
    v_invitation.role,
    'active',
    'invited',
    p_now,
    p_now,
    p_now
  )
  ON CONFLICT (user_id, company_id)
  DO UPDATE SET
    role = EXCLUDED.role,
    status = 'active',
    join_source = 'invited',
    accepted_at = p_now,
    updated_at = p_now;

  UPDATE users
  SET active_company_id = v_invitation.company_id
  WHERE id = p_user_id;

  RETURN QUERY
  SELECT v_invitation.id, v_invitation.company_id, v_invitation.role;
END;
$$;

GRANT EXECUTE ON FUNCTION activate_invitation_membership(UUID, UUID, TIMESTAMPTZ) TO service_role;

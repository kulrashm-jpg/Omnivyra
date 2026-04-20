CREATE TABLE IF NOT EXISTS email_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type TEXT NOT NULL CHECK (job_type IN ('magic_link', 'invite', 'reset')),
  recipient_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  html TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'failed', 'sent')),
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  last_attempt_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS email_jobs_status_idx
  ON email_jobs (status, created_at);

ALTER TABLE invitations
  ADD COLUMN IF NOT EXISTS token_consumed_at TIMESTAMPTZ;

UPDATE invitations
SET revoked_at = COALESCE(revoked_at, expires_at)
WHERE accepted_at IS NULL
  AND revoked_at IS NULL
  AND expires_at <= NOW();

WITH ranked_active AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY LOWER(email), company_id
           ORDER BY created_at DESC, id DESC
         ) AS rn
  FROM invitations
  WHERE accepted_at IS NULL
    AND revoked_at IS NULL
)
UPDATE invitations i
SET revoked_at = NOW()
FROM ranked_active ra
WHERE i.id = ra.id
  AND ra.rn > 1;

DROP INDEX IF EXISTS invitations_pending_unique;

CREATE UNIQUE INDEX IF NOT EXISTS invitations_active_unique
  ON invitations (LOWER(email), company_id)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS super_admin_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS super_admin_audit_logs_actor_idx
  ON super_admin_audit_logs (actor_user_id, created_at DESC);

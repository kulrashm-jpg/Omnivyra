-- Auth audit log table.
--
-- Captures identity-security events that must survive for compliance and
-- breach-investigation purposes. Separate from the operational audit_logs
-- table so retention policies and access controls can differ.
--
-- Events logged here:
--   user_deleted              — account hard/soft-deleted by super-admin
--   role_changed              — user's role in a company was changed
--   ghost_session_detected    — valid Firebase token with no active DB row
--   unauthorized_access_attempt — request blocked by is_deleted or RBAC check
--   domain_validation_failed  — COMPANY_ADMIN invite rejected due to wrong domain

CREATE TABLE IF NOT EXISTS auth_audit_logs (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event        TEXT        NOT NULL,
  user_id      UUID        REFERENCES users(id) ON DELETE SET NULL,
  firebase_uid TEXT,
  metadata     JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fast lookup by event type (for anomaly queries: "how many ghost sessions in the last hour?")
CREATE INDEX IF NOT EXISTS idx_auth_audit_logs_event
  ON auth_audit_logs (event, created_at DESC);

-- Fast lookup per user (for user deletion confirmation: "show all events for user X")
CREATE INDEX IF NOT EXISTS idx_auth_audit_logs_user_id
  ON auth_audit_logs (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

-- Fast lookup per Firebase UID (for pre-onboarding events where user_id may be NULL)
CREATE INDEX IF NOT EXISTS idx_auth_audit_logs_firebase_uid
  ON auth_audit_logs (firebase_uid, created_at DESC)
  WHERE firebase_uid IS NOT NULL;

COMMENT ON TABLE auth_audit_logs IS
  'Immutable security event log. Do not UPDATE or DELETE rows. '
  'Retention: minimum 90 days. Owner: platform-security.';

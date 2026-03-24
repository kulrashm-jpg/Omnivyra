-- Email reuse policy: Option B (permanent reservation)
--
-- Decision: soft-deleted emails are permanently reserved.
-- A deleted account's email can never be used to sign up again.
-- This is enforced at the code level via is_deleted checks in:
--   - /api/auth/check-user        (returns exists=false → sign-up allowed check)
--   - /api/auth/sync-firebase-user (blocks login, returns ACCOUNT_DELETED)
--   - /api/auth/post-login-route   (blocks ghost sessions, returns ACCOUNT_DELETED)
--   - /api/onboarding/complete     (blocks re-onboarding after deletion)
--   - /api/company/users           (blocks adding deleted user to a company)
--   - /api/super-admin/users       (returns ACCOUNT_DELETED instead of creating user)
--
-- The existing UNIQUE(email) constraint on users already covers this at the DB layer
-- for all rows regardless of is_deleted status. This migration adds a partial index
-- and a comment to make the policy explicit and observable.
--
-- NOTE: Do NOT add a partial unique index only on active users — that would allow
-- email reuse, which violates the policy.

-- Document the policy via a table comment (survives pg_dump, visible in pgAdmin/Supabase)
COMMENT ON COLUMN users.email IS
  'Unique email address. Emails belonging to soft-deleted rows (is_deleted=true) '
  'are permanently reserved and cannot be reused. Enforced by UNIQUE constraint '
  'and application-level is_deleted checks. Policy: Option B (no email reuse).';

-- Partial index to speed up soft-delete email lookups (used by the code-level checks)
CREATE INDEX IF NOT EXISTS idx_users_deleted_email
  ON users (email)
  WHERE is_deleted = true;

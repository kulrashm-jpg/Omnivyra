-- ─────────────────────────────────────────────────────────────────────────────
-- Soft-delete for users
--
-- Instead of hard-deleting users from the DB we mark them deleted.
-- Firebase Auth is still hard-deleted (no login possible).
-- This preserves audit trails, FK integrity, and prevents re-signup abuse.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_deleted  BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at  TIMESTAMPTZ;

-- Fast index for auth guards that exclude deleted users
CREATE INDEX IF NOT EXISTS idx_users_is_deleted
  ON users (is_deleted)
  WHERE is_deleted = true;

-- ─────────────────────────────────────────────────────────────────────────────
-- 20260638_user_status_lifecycle.sql
--
-- Phase 2.A — adds the canonical account lifecycle column on `users`.
--
-- States:
--   invited    — created by an admin path (Super-Admin user create); has not
--                yet completed first authenticated session OR password set.
--   active     — operational account (default).
--   suspended  — temporarily blocked from access (reversible); separate from
--                soft-delete, which is permanent.
--   deleted    — soft-deleted (mirrors is_deleted=true). Kept in sync via
--                backfill below + future delete paths.
--
-- DOES NOT overload `onboarding_state` — that column tracks the signup flow
-- (pending_verification → verified → company_complete → active); `status` is
-- the operational gate independent of how the user got there.
--
-- Safe to run twice (IF NOT EXISTS / DO blocks).
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1. Add the column with DEFAULT 'active'. Existing rows materialize as
--    'active' on the very next read; we then patch soft-deleted rows below.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

-- 2. Backfill: soft-deleted rows must read as 'deleted'.
UPDATE users
  SET status = 'deleted'
  WHERE is_deleted = true
    AND status <> 'deleted';

-- 3. CHECK constraint — added after backfill so existing data passes.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.users'::regclass
      AND conname  = 'users_status_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_status_check
      CHECK (status IN ('invited', 'active', 'suspended', 'deleted'));
  END IF;
END $$;

-- 4. Partial index for the two non-default lifecycle states. Admin tooling
--    needs fast "who is currently invited / suspended" lookups.
CREATE INDEX IF NOT EXISTS idx_users_status_lifecycle
  ON users (status)
  WHERE status IN ('invited', 'suspended');

COMMENT ON COLUMN users.status IS
  'Operational lifecycle state. invited=admin-created, awaiting first auth/password; '
  'active=normal; suspended=blocked but recoverable; deleted=mirrors is_deleted. '
  'Distinct from onboarding_state, which tracks the signup-flow stage.';

COMMIT;

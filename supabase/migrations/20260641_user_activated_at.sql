-- ─────────────────────────────────────────────────────────────────────────────
-- 20260641_user_activated_at.sql
--
-- Phase 2.B.1 — adds a per-user activation timestamp paired with the
-- invited → active lifecycle flip.
--
-- Rationale:
--   Migration 20260638 introduced `users.status` with the spec
--   "invited = admin-created, awaiting first authenticated session OR
--    password set". That comment described WHEN the flip should happen
--   but no code path wrote it, so invited users became permanently
--   locked out behind the Phase 2.B auth gates.
--
--   This migration adds `activated_at` so:
--     (a) the activation event is auditable (we know WHEN, not just that
--         the user is `active`),
--     (b) the flip is idempotent: code paths key off `status='invited'`
--         (single-use predicate) and the timestamp only ever gets a value
--         once,
--     (c) downstream telemetry (e.g. activation-funnel dashboards) has
--         a structured signal independent of the operational status.
--
-- Backfill policy: existing 'active' rows keep `activated_at=NULL`. We do
-- NOT retroactively stamp them from `last_sign_in_at` because:
--   - `activated_at` is a forward-looking signal,
--   - mixing real activations with a backfill would corrupt the
--     activation-funnel metric.
--
-- Safe to run twice (IF NOT EXISTS).
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;

COMMENT ON COLUMN users.activated_at IS
  'Timestamp of the invited → active lifecycle transition. Written exactly '
  'once, when sync-supabase-user observes a status=invited row completing '
  'its first authenticated Supabase session. NULL on rows that pre-date '
  'this migration; NULL on rows that were never in the invited state '
  '(direct self-signup / admin-bootstrapped active accounts).';

CREATE INDEX IF NOT EXISTS idx_users_activated_at
  ON users (activated_at)
  WHERE activated_at IS NOT NULL;

COMMIT;

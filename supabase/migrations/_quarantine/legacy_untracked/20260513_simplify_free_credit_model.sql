-- =============================================================================
-- Simplify Free Credit Model — one-time org-scoped grant
--
-- REPLACES the two-tier "initial + unlock" scheme from 20260511/20260512 with a
-- single atomic grant per organization, plus a manual admin-extension channel.
--
-- What this migration does:
--   1. Drops the unlock/event/abuse tables (now dead code).
--   2. Adds a partial UNIQUE index on free_credit_claims that enforces exactly
--      ONE free-credit row per org for category='initial_free_credit'.
--   3. Creates credit_admin_grants — an audit table for manual admin grants
--      issued after the initial free credit has been consumed.
--
-- Existing 'initial'-category rows (from the previous model) are NOT touched —
-- they remain in free_credit_claims as historical audit but do NOT satisfy the
-- new constraint (which fires only on 'initial_free_credit' rows).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Drop the unlock / event / abuse subsystem.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS free_credit_events;
DROP TABLE IF EXISTS pending_invite_unlocks;
DROP TABLE IF EXISTS ip_org_creations;
DROP TABLE IF EXISTS free_credit_unlocks CASCADE;
DROP FUNCTION IF EXISTS update_free_credit_unlock_timestamp();

-- ---------------------------------------------------------------------------
-- 2. Enforce "one free credit per org" at the DB layer.
--    Partial unique index only covers the 'initial_free_credit' category so
--    other categories (extensions, legacy 'initial', etc.) remain unconstrained.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_fcc_org_initial_free_credit
  ON free_credit_claims (organization_id)
  WHERE category = 'initial_free_credit';

-- ---------------------------------------------------------------------------
-- 3. credit_admin_grants — audit log for manual admin credit extensions.
--    Every admin-driven grant writes exactly one row here AND one row to
--    credit_transactions (via createCredit). Cross-referenced by
--    idempotency_key.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS credit_admin_grants (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid        NOT NULL,
  granted_by_user_id uuid        NOT NULL,
  credits_granted    integer     NOT NULL CHECK (credits_granted > 0),
  reason             text        NOT NULL,
  idempotency_key    text        NOT NULL UNIQUE,
  metadata           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cag_org_id      ON credit_admin_grants(organization_id);
CREATE INDEX IF NOT EXISTS idx_cag_granted_by  ON credit_admin_grants(granted_by_user_id);
CREATE INDEX IF NOT EXISTS idx_cag_created_at  ON credit_admin_grants(created_at DESC);

ALTER TABLE credit_admin_grants ENABLE ROW LEVEL SECURITY;
-- Service role only — admin endpoint writes via service key, no direct client access.

-- ─────────────────────────────────────────────────────────────────────────────
-- 20260640_lifecycle_governance.sql
--
-- Phase 2.B — operational governance: suspension, force logout, company
-- disable cascade. Closes the highest-priority gaps from the audit:
--   R3 (no force-logout-other-user), R6 (companies no soft-delete + no
--   cascade), R7 (no global account suspension), R20 (no session revocation
--   beyond JWT expiry).
--
-- Changes:
--   1. users.session_revoked_after TIMESTAMPTZ — the "JWT epoch". Any JWT
--      with iat < this value is rejected by the canonical auth resolver
--      even if its signature is still valid. This is how we invalidate
--      existing stateless Supabase access tokens immediately on suspend /
--      force-logout / company-disable. Default NULL = never revoked.
--   2. companies.deleted_at TIMESTAMPTZ — canonical soft-delete column.
--      Distinct from companies.status ('active'|'inactive') which is a
--      reversible operational flag; deleted_at is the "this row is gone"
--      tombstone.
--   3. invalidate_user_sessions(p_user_id, p_reason) — atomic RPC that
--      bumps session_revoked_after AND revokes every live auth_sessions
--      row for the user in one transaction. Returns the count revoked.
--   4. disable_company_cascade(p_company_id, p_actor, p_reason) — atomic
--      cascade RPC: deactivates every user_company_roles row for the
--      company AND revokes every live auth_session AND bumps every
--      affected user's session_revoked_after AND flips companies.status
--      to 'inactive'. Does NOT touch deleted_at (that's a separate hard
--      delete path). Returns counters.
--   5. soft_delete_company(p_company_id) — explicit soft-delete. Sets
--      deleted_at + cascades.
--
-- Safe to run twice (IF NOT EXISTS / DO blocks).
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. users.session_revoked_after — JWT epoch
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS session_revoked_after TIMESTAMPTZ;

COMMENT ON COLUMN users.session_revoked_after IS
  'The JWT epoch. Any Supabase access token whose iat (issued-at) predates '
  'this value is rejected by the canonical auth resolver, even if the JWT '
  'signature is still valid. Bumped on suspend / force-logout / company-disable. '
  'Default NULL = no revocation has ever occurred for this user.';

CREATE INDEX IF NOT EXISTS idx_users_session_revoked_after
  ON users (session_revoked_after)
  WHERE session_revoked_after IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. companies.deleted_at — canonical soft-delete
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

COMMENT ON COLUMN companies.deleted_at IS
  'Soft-delete tombstone. NULL = live. Set by soft_delete_company RPC. '
  'Distinct from status (active|inactive), which is the reversible '
  'operational flag. Soft-deleted companies cannot be the target of new '
  'role assignments, sessions, or invitations.';

CREATE INDEX IF NOT EXISTS idx_companies_deleted_at
  ON companies (deleted_at)
  WHERE deleted_at IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. invalidate_user_sessions — atomic JWT epoch bump + auth_session revoke
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Effect:
--   users.session_revoked_after = NOW()
--   UPDATE auth_sessions SET revoked_at=NOW(), revocation_reason=p_reason
--     WHERE user_id=p_user_id AND revoked_at IS NULL
--
-- Returns the number of auth_sessions rows revoked. Idempotent — running
-- twice in succession bumps the epoch (which is safe — the JWT is already
-- past it) and returns 0 the second time.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION invalidate_user_sessions(
  p_user_id UUID,
  p_reason  TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_now      TIMESTAMPTZ := NOW();
  v_revoked  INTEGER;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'INVALIDATE_USER_SESSIONS_NULL_USER_ID';
  END IF;
  IF p_reason IS NULL OR LENGTH(TRIM(p_reason)) = 0 THEN
    RAISE EXCEPTION 'INVALIDATE_USER_SESSIONS_MISSING_REASON';
  END IF;

  UPDATE users
    SET session_revoked_after = v_now,
        updated_at = v_now
    WHERE id = p_user_id;

  WITH revoked AS (
    UPDATE auth_sessions
      SET revoked_at = v_now,
          revocation_reason = p_reason
      WHERE user_id = p_user_id
        AND revoked_at IS NULL
      RETURNING id
  )
  SELECT COUNT(*) INTO v_revoked FROM revoked;

  RETURN v_revoked;
END;
$$;

GRANT EXECUTE ON FUNCTION invalidate_user_sessions(UUID, TEXT) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. disable_company_cascade — atomic cascade on disable
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Effect (all in one transaction):
--   1. UPDATE companies SET status='inactive' WHERE id=p_company_id
--   2. For each user_company_roles row in the company with status='active':
--        - SET status='inactive', deactivated_at=NOW
--   3. For each user that had at least one active membership revoked above:
--        - bump session_revoked_after
--        - revoke their live auth_sessions
--      Note: a user may have memberships in OTHER companies. We do NOT
--      filter them — bumping session_revoked_after kills their session
--      everywhere. This is the safe choice when company is being disabled:
--      the operator wants the user gone from the platform pending review.
--
-- Returns:
--   { affected_users: int, revoked_roles: int, revoked_sessions: int }
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION disable_company_cascade(
  p_company_id UUID,
  p_actor      UUID,
  p_reason     TEXT
)
RETURNS TABLE (
  affected_users    INTEGER,
  revoked_roles     INTEGER,
  revoked_sessions  INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_now              TIMESTAMPTZ := NOW();
  v_affected_users   INTEGER     := 0;
  v_revoked_roles    INTEGER     := 0;
  v_revoked_sessions INTEGER     := 0;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'DISABLE_COMPANY_CASCADE_NULL_COMPANY';
  END IF;
  IF p_reason IS NULL OR LENGTH(TRIM(p_reason)) = 0 THEN
    RAISE EXCEPTION 'DISABLE_COMPANY_CASCADE_MISSING_REASON';
  END IF;

  UPDATE companies
    SET status = 'inactive'
    WHERE id = p_company_id;

  -- Lock + flip every active membership; capture user_ids for cascade.
  WITH affected AS (
    UPDATE user_company_roles
      SET status = 'inactive',
          deactivated_at = v_now,
          updated_at = v_now
      WHERE company_id = p_company_id
        AND status = 'active'
      RETURNING user_id
  )
  SELECT COUNT(*) INTO v_revoked_roles FROM affected;

  -- Compute distinct user ids in a subsequent statement (Postgres CTE
  -- limitation around mixing INSERT/UPDATE return + reuse).
  WITH affected_users AS (
    SELECT DISTINCT user_id
    FROM user_company_roles
    WHERE company_id = p_company_id
      AND status = 'inactive'
      AND deactivated_at = v_now
  ),
  bumped AS (
    UPDATE users
      SET session_revoked_after = v_now,
          updated_at = v_now
      WHERE id IN (SELECT user_id FROM affected_users)
      RETURNING id
  ),
  revoked AS (
    UPDATE auth_sessions
      SET revoked_at = v_now,
          revocation_reason = p_reason
      WHERE user_id IN (SELECT user_id FROM affected_users)
        AND revoked_at IS NULL
      RETURNING id
  )
  SELECT
    (SELECT COUNT(*) FROM bumped),
    (SELECT COUNT(*) FROM revoked)
  INTO v_affected_users, v_revoked_sessions;

  RETURN QUERY SELECT v_affected_users, v_revoked_roles, v_revoked_sessions;
END;
$$;

GRANT EXECUTE ON FUNCTION disable_company_cascade(UUID, UUID, TEXT) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. soft_delete_company — sets deleted_at + cascades
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION soft_delete_company(
  p_company_id UUID,
  p_actor      UUID,
  p_reason     TEXT
)
RETURNS TABLE (
  affected_users    INTEGER,
  revoked_roles     INTEGER,
  revoked_sessions  INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_cascade RECORD;
  v_now     TIMESTAMPTZ := NOW();
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'SOFT_DELETE_COMPANY_NULL_COMPANY';
  END IF;
  IF p_reason IS NULL OR LENGTH(TRIM(p_reason)) = 0 THEN
    RAISE EXCEPTION 'SOFT_DELETE_COMPANY_MISSING_REASON';
  END IF;

  -- Run the cascade; reuse the same audit reason.
  SELECT * INTO v_cascade FROM disable_company_cascade(p_company_id, p_actor, p_reason);

  UPDATE companies
    SET deleted_at = v_now
    WHERE id = p_company_id
      AND deleted_at IS NULL;

  RETURN QUERY SELECT v_cascade.affected_users, v_cascade.revoked_roles, v_cascade.revoked_sessions;
END;
$$;

GRANT EXECUTE ON FUNCTION soft_delete_company(UUID, UUID, TEXT) TO service_role;

COMMIT;

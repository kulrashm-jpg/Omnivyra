-- ROLLBACK for 20261210000001_company_lifecycle_super_admin_guard.sql
--
-- ############################################################################
-- #  WARNING — THIS RE-OPENS THE COMPANY-LIFECYCLE / SUPER_ADMIN RACE         #
-- ############################################################################
-- After this runs: disable / soft delete deactivate an ACTIVE SUPER_ADMIN membership again,
-- a concurrent grant can be deactivated (Closure-015K R-9), a SUPER_ADMIN can be granted into a
-- disabled / suspended / deleted company, and hard delete reverts to the application's
-- three-statement path (whose RACE D can orphan an active SUPER_ADMIN row). The application keeps
-- working (hard delete falls back on PGRST202). Data-lossless: no row is changed.
-- Roll back 20261210000002 first if the governed grant must also go (it is independent).

BEGIN;

DROP TRIGGER IF EXISTS trg_guard_super_admin_membership_company ON public.user_company_roles;
DROP FUNCTION IF EXISTS public.guard_super_admin_membership_company();
DROP FUNCTION IF EXISTS public.hard_delete_company(uuid, uuid, text);

-- Restore the baseline disable_company_cascade body (verbatim from supabase/_schema/baseline.sql).
CREATE OR REPLACE FUNCTION public.disable_company_cascade(p_company_id uuid, p_actor uuid, p_reason text) RETURNS TABLE(affected_users integer, revoked_roles integer, revoked_sessions integer)
    LANGUAGE plpgsql SECURITY DEFINER
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

REVOKE ALL ON FUNCTION public.disable_company_cascade(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.disable_company_cascade(uuid, uuid, text) TO service_role;

COMMIT;

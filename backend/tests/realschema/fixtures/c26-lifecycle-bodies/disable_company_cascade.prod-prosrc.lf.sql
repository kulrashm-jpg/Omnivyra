
DECLARE
  v_now              TIMESTAMPTZ := NOW();
  v_affected_users   INTEGER     := 0;
  v_revoked_roles    INTEGER     := 0;
  v_revoked_sessions INTEGER     := 0;
  v_super_admins     INTEGER     := 0;   -- Closure-015L
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'DISABLE_COMPANY_CASCADE_NULL_COMPANY';
  END IF;
  IF p_reason IS NULL OR LENGTH(TRIM(p_reason)) = 0 THEN
    RAISE EXCEPTION 'DISABLE_COMPANY_CASCADE_MISSING_REASON';
  END IF;

  -- Closure-015L: serialization point (lock FIRST), then the protected check.
  PERFORM 1 FROM companies WHERE id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMPANY_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  SELECT COUNT(*) INTO v_super_admins
    FROM user_company_roles
   WHERE company_id = p_company_id
     AND status = 'active'
     AND upper(btrim(role)) = 'SUPER_ADMIN';
  IF v_super_admins > 0 THEN
    RAISE EXCEPTION 'COMPANY_HOLDS_SUPER_ADMIN_MEMBERSHIP'
      USING ERRCODE = 'P0001',
            DETAIL  = format('%s active SUPER_ADMIN membership(s); revoke through identity.admin.revoke first', v_super_admins);
  END IF;

  UPDATE companies
    SET status = 'inactive'
    WHERE id = p_company_id;

  -- Lock + flip every active membership; capture user_ids for cascade.
  -- Closure-015L: RETURNING role as a second, in-statement check (defence in
  -- depth; under the company lock no active SUPER_ADMIN can appear here).
  WITH affected AS (
    UPDATE user_company_roles
      SET status = 'inactive',
          deactivated_at = v_now,
          updated_at = v_now
      WHERE company_id = p_company_id
        AND status = 'active'
      RETURNING user_id, role
  )
  SELECT COUNT(*), COUNT(*) FILTER (WHERE upper(btrim(role)) = 'SUPER_ADMIN')
    INTO v_revoked_roles, v_super_admins
    FROM affected;
  IF v_super_admins > 0 THEN
    RAISE EXCEPTION 'COMPANY_HOLDS_SUPER_ADMIN_MEMBERSHIP' USING ERRCODE = 'P0001';
  END IF;

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

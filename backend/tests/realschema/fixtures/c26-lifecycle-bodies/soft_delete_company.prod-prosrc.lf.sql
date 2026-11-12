
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

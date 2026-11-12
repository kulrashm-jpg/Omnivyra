
DECLARE
  v_super_admins INTEGER := 0;
  v_memberships  INTEGER := 0;
  v_profiles     INTEGER := 0;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'HARD_DELETE_COMPANY_NULL_COMPANY';
  END IF;
  IF p_reason IS NULL OR LENGTH(TRIM(p_reason)) = 0 THEN
    RAISE EXCEPTION 'HARD_DELETE_COMPANY_MISSING_REASON';
  END IF;

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

  -- Non-active SUPER_ADMIN rows confer nothing and are removed with the rest.
  DELETE FROM user_company_roles WHERE company_id = p_company_id;
  GET DIAGNOSTICS v_memberships = ROW_COUNT;
  DELETE FROM company_profiles WHERE company_id = p_company_id::text;   -- company_profiles.company_id is text
  GET DIAGNOSTICS v_profiles = ROW_COUNT;
  -- 238 FKs reference companies: 224 cascade, 9 set null, 5 do not (users.active_company_id, whatsapp_*,
  -- campaign_cost_breakdown): a referencing row now aborts the WHOLE
  -- function (23503) instead of leaving the memberships/profile deleted.
  DELETE FROM companies WHERE id = p_company_id;

  RETURN QUERY SELECT v_memberships, v_profiles;
END;

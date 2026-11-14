
DECLARE
  v_actual int;
BEGIN
  SELECT LEAST(p_amount, free_balance) INTO v_actual
    FROM organization_credits
   WHERE organization_id = p_org_id
   FOR UPDATE;

  IF v_actual IS NULL OR v_actual <= 0 THEN
    RETURN 0;
  END IF;

  UPDATE organization_credits SET
    free_balance = free_balance - v_actual,
    updated_at   = NOW()
  WHERE organization_id = p_org_id;

  RETURN v_actual;
END;

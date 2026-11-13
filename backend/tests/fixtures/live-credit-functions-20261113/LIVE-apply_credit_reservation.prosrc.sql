
DECLARE
  v_wallet   organization_credits%ROWTYPE;
  v_tx_row   credit_transactions%ROWTYPE;
  v_avail_free      int;
  v_avail_incentive int;
  v_avail_paid      int;
  v_tx_type  text;
  v_free_delta      int := 0;
  v_incentive_delta int := 0;
  v_paid_delta      int := 0;
BEGIN
  -- ── Idempotency: return existing row if key already processed ───────────────
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_tx_row
      FROM credit_transactions
     WHERE idempotency_key = p_idempotency_key
     LIMIT 1;
    IF FOUND THEN
      RETURN row_to_json(v_tx_row)::jsonb;
    END IF;
  END IF;

  -- ── Lock the wallet row for this operation ──────────────────────────────────
  SELECT * INTO v_wallet
    FROM organization_credits
   WHERE organization_id = p_org_id
   FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO organization_credits (organization_id)
    VALUES (p_org_id)
    ON CONFLICT (organization_id) DO NOTHING;

    SELECT * INTO v_wallet
      FROM organization_credits
     WHERE organization_id = p_org_id
     FOR UPDATE;
  END IF;

  -- ── Phase dispatch ──────────────────────────────────────────────────────────

  IF p_phase = 'hold' THEN
    v_avail_free      := GREATEST(0, v_wallet.free_balance      - v_wallet.reserved_free);
    v_avail_incentive := GREATEST(0, v_wallet.incentive_balance - v_wallet.reserved_incentive);
    v_avail_paid      := GREATEST(0, v_wallet.paid_balance      - v_wallet.reserved_paid);

    IF p_free_amount > v_avail_free THEN
      RAISE EXCEPTION 'insufficient free balance: need %, have %', p_free_amount, v_avail_free;
    END IF;
    IF p_incentive_amount > v_avail_incentive THEN
      RAISE EXCEPTION 'insufficient incentive balance: need %, have %', p_incentive_amount, v_avail_incentive;
    END IF;
    IF p_paid_amount > v_avail_paid THEN
      RAISE EXCEPTION 'insufficient paid balance: need %, have %', p_paid_amount, v_avail_paid;
    END IF;

    UPDATE organization_credits SET
      free_balance      = free_balance      - p_free_amount,
      incentive_balance = incentive_balance - p_incentive_amount,
      paid_balance      = paid_balance      - p_paid_amount,
      reserved_free     = reserved_free     + p_free_amount,
      reserved_incentive= reserved_incentive+ p_incentive_amount,
      reserved_paid     = reserved_paid     + p_paid_amount,
      updated_at        = NOW()
    WHERE organization_id = p_org_id;

    v_tx_type        := 'deduction';
    v_free_delta     := -p_free_amount;
    v_incentive_delta:= -p_incentive_amount;
    v_paid_delta     := -p_paid_amount;

  ELSIF p_phase = 'confirm' THEN
    UPDATE organization_credits SET
      reserved_free     = GREATEST(0, reserved_free      - p_free_amount),
      reserved_incentive= GREATEST(0, reserved_incentive - p_incentive_amount),
      reserved_paid     = GREATEST(0, reserved_paid      - p_paid_amount),
      lifetime_consumed = lifetime_consumed + p_free_amount + p_incentive_amount + p_paid_amount,
      updated_at        = NOW()
    WHERE organization_id = p_org_id;

    v_tx_type        := 'deduction';
    v_free_delta     := -p_free_amount;
    v_incentive_delta:= -p_incentive_amount;
    v_paid_delta     := -p_paid_amount;

  ELSIF p_phase = 'release' THEN
    UPDATE organization_credits SET
      free_balance      = free_balance      + p_free_amount,
      incentive_balance = incentive_balance + p_incentive_amount,
      paid_balance      = paid_balance      + p_paid_amount,
      reserved_free     = GREATEST(0, reserved_free      - p_free_amount),
      reserved_incentive= GREATEST(0, reserved_incentive - p_incentive_amount),
      reserved_paid     = GREATEST(0, reserved_paid      - p_paid_amount),
      updated_at        = NOW()
    WHERE organization_id = p_org_id;

    v_tx_type        := 'refund';
    v_free_delta     := p_free_amount;
    v_incentive_delta:= p_incentive_amount;
    v_paid_delta     := p_paid_amount;

  ELSIF p_phase = 'grant' THEN
    UPDATE organization_credits SET
      free_balance      = free_balance      + p_free_amount,
      incentive_balance = incentive_balance + p_incentive_amount,
      paid_balance      = paid_balance      + p_paid_amount,
      lifetime_purchased= lifetime_purchased + p_free_amount + p_incentive_amount + p_paid_amount,
      updated_at        = NOW()
    WHERE organization_id = p_org_id;

    v_tx_type        := 'purchase';
    v_free_delta     := p_free_amount;
    v_incentive_delta:= p_incentive_amount;
    v_paid_delta     := p_paid_amount;

  ELSIF p_phase = 'expire' THEN
    -- ── CATEGORY GUARD: expire can only drain free_balance ──────────────────
    -- Paid credits never expire. Incentive credits are expired via a separate
    -- controlled path with explicit config opt-in. Any caller that accidentally
    -- passes non-zero values here gets a hard failure, not a silent no-op.
    IF p_incentive_amount <> 0 THEN
      RAISE EXCEPTION
        'EXPIRY_CATEGORY_GUARD: expire phase cannot touch incentive_balance (p_incentive_amount=%)',
        p_incentive_amount;
    END IF;
    IF p_paid_amount <> 0 THEN
      RAISE EXCEPTION
        'EXPIRY_CATEGORY_GUARD: expire phase cannot touch paid_balance (p_paid_amount=%)',
        p_paid_amount;
    END IF;

    -- Only free_balance is reduced. GREATEST(0, ...) prevents going negative.
    UPDATE organization_credits SET
      free_balance = GREATEST(0, free_balance - p_free_amount),
      updated_at   = NOW()
    WHERE organization_id = p_org_id;

    v_tx_type    := 'deduction';
    v_free_delta := -LEAST(p_free_amount, v_wallet.free_balance);

  ELSIF p_phase = 'expire_incentive' THEN
    -- ── Incentive expiry — separate, explicitly named phase ─────────────────
    -- Only callable when the incentive_expiry config row has is_active=true.
    -- Paid credits are never touched here either.
    IF p_paid_amount <> 0 THEN
      RAISE EXCEPTION
        'EXPIRY_CATEGORY_GUARD: expire_incentive phase cannot touch paid_balance (p_paid_amount=%)',
        p_paid_amount;
    END IF;
    IF p_free_amount <> 0 THEN
      RAISE EXCEPTION
        'EXPIRY_CATEGORY_GUARD: expire_incentive phase cannot touch free_balance (p_free_amount=%)',
        p_free_amount;
    END IF;

    UPDATE organization_credits SET
      incentive_balance = GREATEST(0, incentive_balance - p_incentive_amount),
      updated_at        = NOW()
    WHERE organization_id = p_org_id;

    v_tx_type        := 'deduction';
    v_incentive_delta:= -LEAST(p_incentive_amount, v_wallet.incentive_balance);

  ELSE
    RAISE EXCEPTION 'unknown phase: %', p_phase;
  END IF;

  -- ── Append ledger row ───────────────────────────────────────────────────────
  INSERT INTO credit_transactions (
    organization_id,
    transaction_type,
    credits_delta,
    balance_after,
    reference_type,
    reference_id,
    note,
    performed_by,
    idempotency_key,
    execution_phase,
    parent_transaction_id,
    category,
    free_delta,
    paid_delta,
    incentive_delta,
    created_at
  )
  SELECT
    p_org_id,
    v_tx_type,
    v_free_delta + v_incentive_delta + v_paid_delta,
    oc.free_balance + oc.paid_balance + oc.incentive_balance,
    p_reference_type,
    p_reference_id::uuid,
    p_note,
    p_performed_by,
    p_idempotency_key,
    p_phase,
    p_parent_id,
    p_category,
    v_free_delta,
    v_paid_delta,
    v_incentive_delta,
    NOW()
  FROM organization_credits oc
  WHERE oc.organization_id = p_org_id
  RETURNING * INTO v_tx_row;

  RETURN row_to_json(v_tx_row)::jsonb;

EXCEPTION
  WHEN unique_violation THEN
    SELECT * INTO v_tx_row
      FROM credit_transactions
     WHERE idempotency_key = p_idempotency_key
     LIMIT 1;
    RETURN row_to_json(v_tx_row)::jsonb;
END;

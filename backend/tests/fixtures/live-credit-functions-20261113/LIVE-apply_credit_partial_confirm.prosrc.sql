
DECLARE
  v_tx_row       credit_transactions%ROWTYPE;
  v_hold         credit_transactions%ROWTYPE;

  v_held_free       int;
  v_held_incentive  int;
  v_held_paid       int;

  v_consume_free    int;
  v_consume_incentive int;
  v_consume_paid    int;

  v_excess_free     int;
  v_excess_incentive int;
  v_excess_paid     int;

  v_release_free    int;
  v_release_incentive int;
  v_release_paid    int;

  v_wallet          organization_credits%ROWTYPE;
  v_extra_free      int := 0;
  v_extra_incentive int := 0;
  v_extra_paid      int := 0;
  v_shortfall_free  int := 0;
  v_shortfall_incentive int := 0;
  v_shortfall_paid  int := 0;
  v_is_underfunded  boolean := false;

  v_consumed_total  int;
  v_released_total  int;
BEGIN
  -- ── Idempotency ───────────────────────────────────────────────────────────
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_tx_row
      FROM credit_transactions
     WHERE idempotency_key = p_idempotency_key
     LIMIT 1;
    IF FOUND THEN
      RETURN row_to_json(v_tx_row)::jsonb;
    END IF;
  END IF;

  -- ── Load and validate parent HOLD ─────────────────────────────────────────
  SELECT * INTO v_hold
    FROM credit_transactions
   WHERE id = p_hold_txn_id
     AND organization_id = p_org_id
     AND execution_phase = 'hold';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_hold_found: hold_txn_id=% org=%', p_hold_txn_id, p_org_id;
  END IF;

  -- HOLD deltas are stored NEGATIVE (outflow); flip sign to get held amounts
  v_held_free      := ABS(COALESCE(v_hold.free_delta, 0));
  v_held_incentive := ABS(COALESCE(v_hold.incentive_delta, 0));
  v_held_paid      := ABS(COALESCE(v_hold.paid_delta, 0));

  -- Per-category split:
  --   consume = min(actual, held)
  --   excess  = max(actual - held, 0)   -- needs to come from balance
  --   release = held - consume          -- unused reservation returned
  v_consume_free      := LEAST(p_actual_free,      v_held_free);
  v_consume_incentive := LEAST(p_actual_incentive, v_held_incentive);
  v_consume_paid      := LEAST(p_actual_paid,      v_held_paid);

  v_excess_free       := GREATEST(p_actual_free      - v_held_free,      0);
  v_excess_incentive  := GREATEST(p_actual_incentive - v_held_incentive, 0);
  v_excess_paid       := GREATEST(p_actual_paid      - v_held_paid,      0);

  v_release_free      := v_held_free      - v_consume_free;
  v_release_incentive := v_held_incentive - v_consume_incentive;
  v_release_paid      := v_held_paid      - v_consume_paid;

  -- ── Lock wallet and apply ─────────────────────────────────────────────────
  SELECT * INTO v_wallet
    FROM organization_credits
   WHERE organization_id = p_org_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_credit_account: org %', p_org_id;
  END IF;

  -- 1. Consume from reserved (the "CONFIRM" part):
  --    reserved_X -= consume_X
  --    lifetime_consumed += consume_X
  -- 2. Release unused reservation (the "RELEASE" part):
  --    reserved_X -= release_X
  --    balance_X  += release_X
  -- 3. Excess consumption — try to pull from balance; underfunded if insufficient:
  --    take = min(excess, balance_after_release)
  --    balance_X  -= take
  --    lifetime_consumed += take
  --    shortfall_X = excess - take

  -- Apply (1) + (2) first, then compute excess from updated balance
  UPDATE organization_credits SET
    reserved_free      = GREATEST(0, reserved_free      - v_consume_free      - v_release_free),
    reserved_incentive = GREATEST(0, reserved_incentive - v_consume_incentive - v_release_incentive),
    reserved_paid      = GREATEST(0, reserved_paid      - v_consume_paid      - v_release_paid),
    free_balance       = free_balance      + v_release_free,
    incentive_balance  = incentive_balance + v_release_incentive,
    paid_balance       = paid_balance      + v_release_paid,
    lifetime_consumed  = lifetime_consumed + v_consume_free + v_consume_incentive + v_consume_paid,
    updated_at         = NOW()
  WHERE organization_id = p_org_id
  RETURNING * INTO v_wallet;

  -- (3) Excess from balance
  IF v_excess_free > 0 THEN
    v_extra_free     := LEAST(v_excess_free, v_wallet.free_balance);
    v_shortfall_free := v_excess_free - v_extra_free;
  END IF;
  IF v_excess_incentive > 0 THEN
    v_extra_incentive     := LEAST(v_excess_incentive, v_wallet.incentive_balance);
    v_shortfall_incentive := v_excess_incentive - v_extra_incentive;
  END IF;
  IF v_excess_paid > 0 THEN
    v_extra_paid     := LEAST(v_excess_paid, v_wallet.paid_balance);
    v_shortfall_paid := v_excess_paid - v_extra_paid;
  END IF;

  IF (v_extra_free + v_extra_incentive + v_extra_paid) > 0 THEN
    UPDATE organization_credits SET
      free_balance      = free_balance      - v_extra_free,
      incentive_balance = incentive_balance - v_extra_incentive,
      paid_balance      = paid_balance      - v_extra_paid,
      lifetime_consumed = lifetime_consumed + v_extra_free + v_extra_incentive + v_extra_paid,
      updated_at        = NOW()
    WHERE organization_id = p_org_id;
  END IF;

  v_is_underfunded := (v_shortfall_free + v_shortfall_incentive + v_shortfall_paid) > 0;

  v_consumed_total := v_consume_free + v_consume_incentive + v_consume_paid
                    + v_extra_free   + v_extra_incentive   + v_extra_paid;
  v_released_total := v_release_free + v_release_incentive + v_release_paid;

  -- ── Append ledger row ─────────────────────────────────────────────────────
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
    is_underfunded,
    created_at
  )
  VALUES (
    p_org_id,
    'deduction',
    -v_consumed_total,
    (v_wallet.free_balance + v_wallet.paid_balance + v_wallet.incentive_balance)
      - v_extra_free - v_extra_incentive - v_extra_paid,
    p_reference_type,
    p_reference_id::uuid,
    COALESCE(p_note, 'confirm_partial') ||
      CASE WHEN v_is_underfunded
           THEN ' [UNDERFUNDED shortfall_total=' ||
                (v_shortfall_free + v_shortfall_incentive + v_shortfall_paid) || ']'
           ELSE '' END,
    p_performed_by,
    p_idempotency_key,
    'confirm_partial',
    p_hold_txn_id,
    'paid',
    -(v_consume_free      + v_extra_free),
    -(v_consume_paid      + v_extra_paid),
    -(v_consume_incentive + v_extra_incentive),
    v_is_underfunded,
    NOW()
  )
  RETURNING * INTO v_tx_row;

  RETURN jsonb_build_object(
    'id',                 v_tx_row.id,
    'consumed_free',      v_consume_free      + v_extra_free,
    'consumed_incentive', v_consume_incentive + v_extra_incentive,
    'consumed_paid',      v_consume_paid      + v_extra_paid,
    'released_free',      v_release_free,
    'released_incentive', v_release_incentive,
    'released_paid',      v_release_paid,
    'shortfall_free',     v_shortfall_free,
    'shortfall_incentive',v_shortfall_incentive,
    'shortfall_paid',     v_shortfall_paid,
    'is_underfunded',     v_is_underfunded,
    'total_consumed',     v_consumed_total,
    'total_released',     v_released_total
  );

EXCEPTION
  WHEN unique_violation THEN
    SELECT * INTO v_tx_row
      FROM credit_transactions
     WHERE idempotency_key = p_idempotency_key
     LIMIT 1;
    RETURN row_to_json(v_tx_row)::jsonb;
END;

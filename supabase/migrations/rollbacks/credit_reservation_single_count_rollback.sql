-- ROLLBACK for 20270217000001_credit_reservation_single_count.
--
-- Restores the EXACT pre-image body (byte for byte) - never an inverse
-- replace(): the forward patch collapses whitespace, so a hand-written inverse
-- would be semantically right and md5-DIFFERENT, and every later md5-pinned
-- migration would then refuse a body that is actually the right one (05).
--
-- Pre-images embedded verbatim:
--   prod:      83/C17 saved prosrc (C17-apply_credit_reservation.prod-prosrc.sql),
--              md5 ad5383bf6ccf24a2c8ddee70db3b1297
--   20260625:  the body as written in 20260625_monetization_invariant_hardening.sql,
--              md5 c62d8dde5e3ad20a22ad6fd8ccc77154
-- LINE ENDINGS: each form restores its OWN pre-image form (byte for byte):
--   live 03d616e6 (LF)   -> prod LF ad5383bf ; live 90bcbfb5 (CRLF) -> prod CRLF 1db00c4d
--   live 7799ec27 (LF)   -> 20260625 LF c62d8dde ; live 7ee214ad (CRLF) -> 20260625 CRLF 6e9ef990
-- The embedded pre-images are LF; the CRLF form is rebuilt with replace(E'\n', E'\r\n')
-- and verified by md5. A live pre-image -> no-op; anything else -> RAISE.
-- Re-asserts search_path and grants; verifies the restored md5.

DO $rollback$
DECLARE
  v_oid    oid := to_regprocedure('public.apply_credit_reservation(uuid,text,integer,integer,integer,text,text,text,text,uuid,uuid,text)');
  v_md5    text;
  v_args   text;
  v_body   text;
  v_expect text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'single_count rollback: apply_credit_reservation not found';
  END IF;
  SELECT md5(p.prosrc), pg_get_function_arguments(p.oid) INTO v_md5, v_args FROM pg_proc p WHERE p.oid = v_oid;
  IF v_md5 IN ('ad5383bf6ccf24a2c8ddee70db3b1297', '1db00c4d06a4a16c84ed419c4cc47bf6',
               'c62d8dde5e3ad20a22ad6fd8ccc77154', '6e9ef99095e506a3c70fb2dde9686de9') THEN
    RAISE NOTICE 'single_count rollback: pre-image already live (md5 %) - no change', v_md5;
    RETURN;
  ELSIF v_md5 IN ('03d616e692cdfb9fefc25eb81e8e4595', '90bcbfb5e9eb2eedf1a0b7a8266554bf') THEN
    v_body := $preimage_prod$
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
$preimage_prod$;
    v_expect := 'ad5383bf6ccf24a2c8ddee70db3b1297';
    IF v_md5 = '90bcbfb5e9eb2eedf1a0b7a8266554bf' THEN
      v_body := replace(v_body, E'\n', E'\r\n');
      v_expect := '1db00c4d06a4a16c84ed419c4cc47bf6';
    END IF;
  ELSIF v_md5 IN ('7799ec2755c49c952bacd529916acc9c', '7ee214ad28938b36d57f63eb68a9b9cd') THEN
    v_body := $preimage_20260625$
DECLARE
  v_wallet organization_credits%ROWTYPE;
  v_tx_row credit_transactions%ROWTYPE;
  v_hold credit_transactions%ROWTYPE;
  v_existing_terminal credit_transactions%ROWTYPE;
  v_tx_type text;
  v_free_delta int := 0;
  v_incentive_delta int := 0;
  v_paid_delta int := 0;
  v_total int := COALESCE(p_free_amount, 0) + COALESCE(p_incentive_amount, 0) + COALESCE(p_paid_amount, 0);
BEGIN
  p_free_amount := COALESCE(p_free_amount, 0);
  p_incentive_amount := COALESCE(p_incentive_amount, 0);
  p_paid_amount := COALESCE(p_paid_amount, 0);

  IF p_phase IS NULL OR p_phase NOT IN ('hold', 'confirm', 'release', 'grant', 'expire', 'expire_incentive') THEN
    RAISE EXCEPTION 'unknown phase: %', p_phase;
  END IF;
  IF p_free_amount < 0 OR p_incentive_amount < 0 OR p_paid_amount < 0 THEN
    RAISE EXCEPTION 'credit amounts must be non-negative';
  END IF;
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'idempotency_key is required';
  END IF;

  SELECT * INTO v_tx_row
    FROM credit_transactions
   WHERE idempotency_key = p_idempotency_key
   LIMIT 1;
  IF FOUND THEN
    RETURN row_to_json(v_tx_row)::jsonb;
  END IF;

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

  IF p_phase IN ('confirm', 'release') THEN
    IF p_parent_id IS NULL THEN
      RAISE EXCEPTION '% requires parent HOLD transaction id', p_phase;
    END IF;

    SELECT * INTO v_hold
      FROM credit_transactions
     WHERE id = p_parent_id
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION '% without valid HOLD: parent % not found', p_phase, p_parent_id;
    END IF;
    IF v_hold.organization_id <> p_org_id THEN
      RAISE EXCEPTION '% org mismatch: hold org %, request org %', p_phase, v_hold.organization_id, p_org_id;
    END IF;
    IF v_hold.execution_phase <> 'hold' THEN
      RAISE EXCEPTION '% parent must be HOLD, got %', p_phase, v_hold.execution_phase;
    END IF;

    SELECT * INTO v_existing_terminal
      FROM credit_transactions
     WHERE parent_transaction_id = p_parent_id
       AND execution_phase IN ('confirm', 'release')
     LIMIT 1;

    IF FOUND THEN
      RAISE EXCEPTION 'HOLD % already settled by % transaction %', p_parent_id, v_existing_terminal.execution_phase, v_existing_terminal.id;
    END IF;

    IF p_free_amount > abs(v_hold.free_delta)
       OR p_incentive_amount > abs(v_hold.incentive_delta)
       OR p_paid_amount > abs(v_hold.paid_delta) THEN
      RAISE EXCEPTION '% amount exceeds parent HOLD split', p_phase;
    END IF;
    IF p_free_amount > v_wallet.reserved_free
       OR p_incentive_amount > v_wallet.reserved_incentive
       OR p_paid_amount > v_wallet.reserved_paid THEN
      RAISE EXCEPTION '% would make reserved balance negative', p_phase;
    END IF;
  END IF;

  IF p_phase = 'hold' THEN
    IF p_parent_id IS NOT NULL THEN
      RAISE EXCEPTION 'HOLD cannot have a parent transaction';
    END IF;
    IF p_free_amount > (v_wallet.free_balance - v_wallet.reserved_free) THEN
      RAISE EXCEPTION 'insufficient free balance: need %, have %', p_free_amount, (v_wallet.free_balance - v_wallet.reserved_free);
    END IF;
    IF p_incentive_amount > (v_wallet.incentive_balance - v_wallet.reserved_incentive) THEN
      RAISE EXCEPTION 'insufficient incentive balance: need %, have %', p_incentive_amount, (v_wallet.incentive_balance - v_wallet.reserved_incentive);
    END IF;
    IF p_paid_amount > (v_wallet.paid_balance - v_wallet.reserved_paid) THEN
      RAISE EXCEPTION 'insufficient paid balance: need %, have %', p_paid_amount, (v_wallet.paid_balance - v_wallet.reserved_paid);
    END IF;

    UPDATE organization_credits SET
      free_balance       = free_balance - p_free_amount,
      incentive_balance  = incentive_balance - p_incentive_amount,
      paid_balance       = paid_balance - p_paid_amount,
      reserved_free      = reserved_free + p_free_amount,
      reserved_incentive = reserved_incentive + p_incentive_amount,
      reserved_paid      = reserved_paid + p_paid_amount,
      updated_at         = now()
    WHERE organization_id = p_org_id;

    v_tx_type := 'deduction';
    v_free_delta := -p_free_amount;
    v_incentive_delta := -p_incentive_amount;
    v_paid_delta := -p_paid_amount;

  ELSIF p_phase = 'confirm' THEN
    UPDATE organization_credits SET
      reserved_free      = reserved_free - p_free_amount,
      reserved_incentive = reserved_incentive - p_incentive_amount,
      reserved_paid      = reserved_paid - p_paid_amount,
      lifetime_consumed  = lifetime_consumed + v_total,
      updated_at         = now()
    WHERE organization_id = p_org_id;

    v_tx_type := 'deduction';
    v_free_delta := -p_free_amount;
    v_incentive_delta := -p_incentive_amount;
    v_paid_delta := -p_paid_amount;

  ELSIF p_phase = 'release' THEN
    UPDATE organization_credits SET
      free_balance       = free_balance + p_free_amount,
      incentive_balance  = incentive_balance + p_incentive_amount,
      paid_balance       = paid_balance + p_paid_amount,
      reserved_free      = reserved_free - p_free_amount,
      reserved_incentive = reserved_incentive - p_incentive_amount,
      reserved_paid      = reserved_paid - p_paid_amount,
      updated_at         = now()
    WHERE organization_id = p_org_id;

    v_tx_type := 'refund';
    v_free_delta := p_free_amount;
    v_incentive_delta := p_incentive_amount;
    v_paid_delta := p_paid_amount;

  ELSIF p_phase = 'grant' THEN
    IF p_parent_id IS NOT NULL THEN
      RAISE EXCEPTION 'grant cannot have a parent transaction';
    END IF;
    UPDATE organization_credits SET
      free_balance       = free_balance + p_free_amount,
      incentive_balance  = incentive_balance + p_incentive_amount,
      paid_balance       = paid_balance + p_paid_amount,
      lifetime_purchased = lifetime_purchased + v_total,
      updated_at         = now()
    WHERE organization_id = p_org_id;

    v_tx_type := 'purchase';
    v_free_delta := p_free_amount;
    v_incentive_delta := p_incentive_amount;
    v_paid_delta := p_paid_amount;

  ELSIF p_phase = 'expire' THEN
    IF p_parent_id IS NOT NULL THEN
      RAISE EXCEPTION 'expire cannot have a parent transaction';
    END IF;
    IF p_incentive_amount <> 0 OR p_paid_amount <> 0 THEN
      RAISE EXCEPTION 'EXPIRY_CATEGORY_GUARD: expire can only touch free_balance';
    END IF;
    IF p_free_amount > v_wallet.free_balance THEN
      RAISE EXCEPTION 'expire amount exceeds free balance';
    END IF;
    UPDATE organization_credits SET
      free_balance = free_balance - p_free_amount,
      updated_at = now()
    WHERE organization_id = p_org_id;

    v_tx_type := 'deduction';
    v_free_delta := -p_free_amount;

  ELSIF p_phase = 'expire_incentive' THEN
    IF p_parent_id IS NOT NULL THEN
      RAISE EXCEPTION 'expire_incentive cannot have a parent transaction';
    END IF;
    IF p_free_amount <> 0 OR p_paid_amount <> 0 THEN
      RAISE EXCEPTION 'EXPIRY_CATEGORY_GUARD: expire_incentive can only touch incentive_balance';
    END IF;
    IF p_incentive_amount > v_wallet.incentive_balance THEN
      RAISE EXCEPTION 'expire_incentive amount exceeds incentive balance';
    END IF;
    UPDATE organization_credits SET
      incentive_balance = incentive_balance - p_incentive_amount,
      updated_at = now()
    WHERE organization_id = p_org_id;

    v_tx_type := 'deduction';
    v_incentive_delta := -p_incentive_amount;
  END IF;

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
    p_reference_id,
    p_note,
    p_performed_by,
    p_idempotency_key,
    p_phase,
    p_parent_id,
    p_category,
    v_free_delta,
    v_paid_delta,
    v_incentive_delta,
    now()
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
    IF FOUND THEN
      RETURN row_to_json(v_tx_row)::jsonb;
    END IF;
    RAISE;
END;
$preimage_20260625$;
    v_expect := 'c62d8dde5e3ad20a22ad6fd8ccc77154';
    IF v_md5 = '7ee214ad28938b36d57f63eb68a9b9cd' THEN
      v_body := replace(v_body, E'\n', E'\r\n');
      v_expect := '6e9ef99095e506a3c70fb2dde9686de9';
    END IF;
  ELSE
    RAISE EXCEPTION 'single_count rollback: UNKNOWN live body (md5 %) - refusing; nothing changed', v_md5;
  END IF;
  IF md5(v_body) <> v_expect THEN
    RAISE EXCEPTION 'single_count rollback: embedded pre-image md5 % <> % - refusing', md5(v_body), v_expect;
  END IF;
  EXECUTE format(
    'CREATE OR REPLACE FUNCTION public.apply_credit_reservation(%s) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS %L',
    v_args, v_body);
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p WHERE p.oid = v_oid;
  IF v_md5 IS DISTINCT FROM v_expect THEN
    RAISE EXCEPTION 'single_count rollback: postcondition failed - live md5 % <> %', v_md5, v_expect;
  END IF;
END
$rollback$;

ALTER FUNCTION public.apply_credit_reservation(uuid,text,integer,integer,integer,text,text,text,text,uuid,uuid,text) SET search_path = pg_catalog, public;
REVOKE ALL ON FUNCTION public.apply_credit_reservation(uuid,text,integer,integer,integer,text,text,text,text,uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_credit_reservation(uuid,text,integer,integer,integer,text,text,text,text,uuid,uuid,text) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 20260323_remove_balance_credits
--
-- Objective: Remove the legacy `balance_credits` field from
--   `organization_credits` now that all TypeScript code reads the three
--   category columns (free_balance, paid_balance, incentive_balance) and all
--   credit mutations flow through apply_credit_reservation (which never wrote
--   to balance_credits for deductions — only grants/expires did).
--
-- Steps:
--   1. Replace apply_credit_reservation — remove balance_credits writes from
--      the grant and expire phases.
--   2. Replace expire_org_free_credits — remove balance_credits write.
--   3. Drop apply_credit_transaction (v1) — all TypeScript call-sites removed.
--   4. Drop apply_credit_transaction_v2 — superseded by apply_credit_reservation.
--   5. Drop the balance_credits column.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Replace apply_credit_reservation (drop balance_credits writes) ─────────

CREATE OR REPLACE FUNCTION apply_credit_reservation(
  p_org_id           uuid,
  p_phase            text,
  p_free_amount      int  DEFAULT 0,
  p_incentive_amount int  DEFAULT 0,
  p_paid_amount      int  DEFAULT 0,
  p_idempotency_key  text DEFAULT NULL,
  p_reference_type   text DEFAULT NULL,
  p_reference_id     text DEFAULT NULL,
  p_note             text DEFAULT NULL,
  p_performed_by     uuid DEFAULT NULL,
  p_parent_id        uuid DEFAULT NULL,
  p_category         text DEFAULT 'paid'
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
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
    -- Auto-create wallet if missing (first operation for this org)
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
    -- Compute available (unreserved) per category
    v_avail_free      := GREATEST(0, v_wallet.free_balance      - v_wallet.reserved_free);
    v_avail_incentive := GREATEST(0, v_wallet.incentive_balance - v_wallet.reserved_incentive);
    v_avail_paid      := GREATEST(0, v_wallet.paid_balance      - v_wallet.reserved_paid);

    -- Validate requested amounts fit within available
    IF p_free_amount > v_avail_free THEN
      RAISE EXCEPTION 'insufficient free balance: need %, have %', p_free_amount, v_avail_free;
    END IF;
    IF p_incentive_amount > v_avail_incentive THEN
      RAISE EXCEPTION 'insufficient incentive balance: need %, have %', p_incentive_amount, v_avail_incentive;
    END IF;
    IF p_paid_amount > v_avail_paid THEN
      RAISE EXCEPTION 'insufficient paid balance: need %, have %', p_paid_amount, v_avail_paid;
    END IF;

    -- Move from balance → reserved
    UPDATE organization_credits SET
      free_balance      = free_balance      - p_free_amount,
      incentive_balance = incentive_balance - p_incentive_amount,
      paid_balance      = paid_balance      - p_paid_amount,
      reserved_free     = reserved_free     + p_free_amount,
      reserved_incentive= reserved_incentive+ p_incentive_amount,
      reserved_paid     = reserved_paid     + p_paid_amount,
      updated_at        = NOW()
    WHERE organization_id = p_org_id;

    v_tx_type       := 'deduction';
    v_free_delta     := -p_free_amount;
    v_incentive_delta:= -p_incentive_amount;
    v_paid_delta     := -p_paid_amount;

  ELSIF p_phase = 'confirm' THEN
    -- Deduct from reserved → consumed (balance was already moved at HOLD)
    UPDATE organization_credits SET
      reserved_free     = GREATEST(0, reserved_free      - p_free_amount),
      reserved_incentive= GREATEST(0, reserved_incentive - p_incentive_amount),
      reserved_paid     = GREATEST(0, reserved_paid      - p_paid_amount),
      lifetime_consumed = lifetime_consumed + p_free_amount + p_incentive_amount + p_paid_amount,
      updated_at        = NOW()
    WHERE organization_id = p_org_id;

    v_tx_type       := 'deduction';
    v_free_delta     := -p_free_amount;
    v_incentive_delta:= -p_incentive_amount;
    v_paid_delta     := -p_paid_amount;

  ELSIF p_phase = 'release' THEN
    -- Restore reserved → balance
    UPDATE organization_credits SET
      free_balance      = free_balance      + p_free_amount,
      incentive_balance = incentive_balance + p_incentive_amount,
      paid_balance      = paid_balance      + p_paid_amount,
      reserved_free     = GREATEST(0, reserved_free      - p_free_amount),
      reserved_incentive= GREATEST(0, reserved_incentive - p_incentive_amount),
      reserved_paid     = GREATEST(0, reserved_paid      - p_paid_amount),
      updated_at        = NOW()
    WHERE organization_id = p_org_id;

    v_tx_type       := 'refund';
    v_free_delta     := p_free_amount;
    v_incentive_delta:= p_incentive_amount;
    v_paid_delta     := p_paid_amount;

  ELSIF p_phase = 'grant' THEN
    -- Add credits to specified category balances
    UPDATE organization_credits SET
      free_balance      = free_balance      + p_free_amount,
      incentive_balance = incentive_balance + p_incentive_amount,
      paid_balance      = paid_balance      + p_paid_amount,
      lifetime_purchased= lifetime_purchased + p_free_amount + p_incentive_amount + p_paid_amount,
      updated_at        = NOW()
    WHERE organization_id = p_org_id;

    v_tx_type       := 'purchase';
    v_free_delta     := p_free_amount;
    v_incentive_delta:= p_incentive_amount;
    v_paid_delta     := p_paid_amount;

  ELSIF p_phase = 'expire' THEN
    -- Direct removal from free_balance (expiry job)
    UPDATE organization_credits SET
      free_balance = GREATEST(0, free_balance - p_free_amount),
      updated_at   = NOW()
    WHERE organization_id = p_org_id;

    v_tx_type    := 'deduction';
    v_free_delta := -LEAST(p_free_amount, v_wallet.free_balance);

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
    oc.free_balance + oc.paid_balance + oc.incentive_balance,  -- balance_after = sum of categories
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
    -- Concurrent idempotency collision — return the existing row
    SELECT * INTO v_tx_row
      FROM credit_transactions
     WHERE idempotency_key = p_idempotency_key
     LIMIT 1;
    RETURN row_to_json(v_tx_row)::jsonb;
END;
$$;

-- ── 2. Replace expire_org_free_credits (drop balance_credits write) ───────────

CREATE OR REPLACE FUNCTION expire_org_free_credits(
  p_org_id uuid,
  p_amount int,
  p_note   text DEFAULT 'free credit expiry'
) RETURNS int
LANGUAGE plpgsql
AS $$
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
$$;

-- ── 3. Drop legacy RPCs (all TypeScript call-sites removed) ───────────────────

DROP FUNCTION IF EXISTS apply_credit_transaction(
  uuid, text, numeric, numeric, text, uuid, text, uuid
);

DROP FUNCTION IF EXISTS apply_credit_transaction_v2(
  uuid, text, int, numeric, text, text, text, uuid, text, text, uuid, text, jsonb
);

-- ── 4. Drop balance_credits column ────────────────────────────────────────────
-- The column was a running total maintained by the old RPCs.
-- All reads now use free_balance + paid_balance + incentive_balance.
-- balance_after in credit_transactions is already computed from the category sum
-- in the updated apply_credit_reservation above.

ALTER TABLE organization_credits DROP COLUMN IF EXISTS balance_credits;

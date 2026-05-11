-- Monetization invariant hardening
--
-- Payment-grade safety pass for the credit reservation ledger.
-- - Terminal phases require a valid parent HOLD.
-- - CONFIRM/RELEASE are mutually exclusive and idempotent.
-- - Reserved balances are checked explicitly; no silent GREATEST(0, ...)
--   masking remains for reservation terminal phases.
-- - Partial confirm is restored as a canonical RPC and records both the
--   consumed CONFIRM and any released hold remainder.
-- - credit_transactions.reference_id is normalized to text because current
--   work-unit references are not guaranteed to be UUIDs.

ALTER TABLE credit_transactions
  ALTER COLUMN reference_id TYPE text USING reference_id::text;

ALTER TABLE credit_transactions
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_credit_tx_parent_phase
  ON credit_transactions(parent_transaction_id, execution_phase);

CREATE INDEX IF NOT EXISTS idx_credit_tx_org_phase_key
  ON credit_transactions(organization_id, execution_phase, idempotency_key);

ALTER TABLE credit_purchases
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS provider_event_id text,
  ADD COLUMN IF NOT EXISTS provider_payment_id text,
  ADD COLUMN IF NOT EXISTS fulfillment_status text NOT NULL DEFAULT 'pending'
    CHECK (fulfillment_status IN ('pending', 'event_recorded', 'completed', 'failed')),
  ADD COLUMN IF NOT EXISTS fulfilled_at timestamptz,
  ADD COLUMN IF NOT EXISTS fulfillment_error text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_purchases_provider_event_unique
  ON credit_purchases(provider, provider_event_id)
  WHERE provider IS NOT NULL AND provider_event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS payment_provider_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  purchase_id uuid REFERENCES credit_purchases(id),
  organization_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  processing_status text NOT NULL DEFAULT 'recorded'
    CHECK (processing_status IN ('recorded', 'processed', 'duplicate', 'failed')),
  error_message text,
  UNIQUE (provider, provider_event_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_provider_events_purchase
  ON payment_provider_events(purchase_id, received_at DESC);

CREATE OR REPLACE FUNCTION record_payment_provider_event(
  p_provider text,
  p_provider_event_id text,
  p_event_type text,
  p_purchase_id uuid DEFAULT NULL,
  p_organization_id uuid DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_event payment_provider_events%ROWTYPE;
BEGIN
  IF p_provider IS NULL OR btrim(p_provider) = '' THEN
    RAISE EXCEPTION 'payment provider is required';
  END IF;
  IF p_provider_event_id IS NULL OR btrim(p_provider_event_id) = '' THEN
    RAISE EXCEPTION 'provider_event_id is required';
  END IF;

  INSERT INTO payment_provider_events (
    provider,
    provider_event_id,
    event_type,
    purchase_id,
    organization_id,
    payload
  )
  VALUES (
    p_provider,
    p_provider_event_id,
    p_event_type,
    p_purchase_id,
    p_organization_id,
    COALESCE(p_payload, '{}'::jsonb)
  )
  ON CONFLICT (provider, provider_event_id) DO UPDATE
    SET processing_status = payment_provider_events.processing_status
  RETURNING * INTO v_event;

  RETURN row_to_json(v_event)::jsonb;
END;
$$;

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
$$;

CREATE OR REPLACE FUNCTION apply_credit_partial_confirm(
  p_org_id uuid,
  p_hold_txn_id uuid,
  p_actual_free int DEFAULT 0,
  p_actual_incentive int DEFAULT 0,
  p_actual_paid int DEFAULT 0,
  p_idempotency_key text DEFAULT NULL,
  p_reference_type text DEFAULT NULL,
  p_reference_id text DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_performed_by uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_wallet organization_credits%ROWTYPE;
  v_hold credit_transactions%ROWTYPE;
  v_existing credit_transactions%ROWTYPE;
  v_confirm credit_transactions%ROWTYPE;
  v_release credit_transactions%ROWTYPE;
  v_hold_free int;
  v_hold_incentive int;
  v_hold_paid int;
  v_release_free int;
  v_release_incentive int;
  v_release_paid int;
  v_actual_total int;
  v_release_total int;
  v_release_key text;
BEGIN
  p_actual_free := COALESCE(p_actual_free, 0);
  p_actual_incentive := COALESCE(p_actual_incentive, 0);
  p_actual_paid := COALESCE(p_actual_paid, 0);
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'idempotency_key is required';
  END IF;
  IF p_actual_free < 0 OR p_actual_incentive < 0 OR p_actual_paid < 0 THEN
    RAISE EXCEPTION 'actual amounts must be non-negative';
  END IF;

  SELECT * INTO v_existing
    FROM credit_transactions
   WHERE idempotency_key = p_idempotency_key
   LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'id', v_existing.id,
      'total_consumed', abs(v_existing.free_delta) + abs(v_existing.incentive_delta) + abs(v_existing.paid_delta),
      'total_released', 0,
      'is_underfunded', false
    );
  END IF;

  SELECT * INTO v_hold
    FROM credit_transactions
   WHERE id = p_hold_txn_id
   FOR UPDATE;

  IF NOT FOUND OR v_hold.execution_phase <> 'hold' THEN
    RAISE EXCEPTION 'partial_confirm requires a valid HOLD parent';
  END IF;
  IF v_hold.organization_id <> p_org_id THEN
    RAISE EXCEPTION 'partial_confirm org mismatch';
  END IF;

  SELECT * INTO v_existing
    FROM credit_transactions
   WHERE parent_transaction_id = p_hold_txn_id
     AND execution_phase IN ('confirm', 'release')
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'HOLD % already settled by % transaction %', p_hold_txn_id, v_existing.execution_phase, v_existing.id;
  END IF;

  SELECT * INTO v_wallet
    FROM organization_credits
   WHERE organization_id = p_org_id
   FOR UPDATE;

  v_hold_free := abs(v_hold.free_delta);
  v_hold_incentive := abs(v_hold.incentive_delta);
  v_hold_paid := abs(v_hold.paid_delta);

  IF p_actual_free > v_hold_free OR p_actual_incentive > v_hold_incentive OR p_actual_paid > v_hold_paid THEN
    RAISE EXCEPTION 'partial_confirm actual amount exceeds secured HOLD';
  END IF;
  IF v_hold_free > v_wallet.reserved_free OR v_hold_incentive > v_wallet.reserved_incentive OR v_hold_paid > v_wallet.reserved_paid THEN
    RAISE EXCEPTION 'partial_confirm would make reserved balance negative';
  END IF;

  v_release_free := v_hold_free - p_actual_free;
  v_release_incentive := v_hold_incentive - p_actual_incentive;
  v_release_paid := v_hold_paid - p_actual_paid;
  v_actual_total := p_actual_free + p_actual_incentive + p_actual_paid;
  v_release_total := v_release_free + v_release_incentive + v_release_paid;

  UPDATE organization_credits SET
    reserved_free      = reserved_free - v_hold_free,
    reserved_incentive = reserved_incentive - v_hold_incentive,
    reserved_paid      = reserved_paid - v_hold_paid,
    free_balance       = free_balance + v_release_free,
    incentive_balance  = incentive_balance + v_release_incentive,
    paid_balance       = paid_balance + v_release_paid,
    lifetime_consumed  = lifetime_consumed + v_actual_total,
    updated_at         = now()
  WHERE organization_id = p_org_id;

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
    'deduction',
    -(v_actual_total),
    oc.free_balance + oc.paid_balance + oc.incentive_balance,
    p_reference_type,
    p_reference_id,
    p_note,
    p_performed_by,
    p_idempotency_key,
    'confirm',
    p_hold_txn_id,
    'paid',
    -p_actual_free,
    -p_actual_paid,
    -p_actual_incentive,
    now()
  FROM organization_credits oc
  WHERE oc.organization_id = p_org_id
  RETURNING * INTO v_confirm;

  IF v_release_total > 0 THEN
    v_release_key := p_idempotency_key || ':release-remainder';
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
      'refund',
      v_release_total,
      oc.free_balance + oc.paid_balance + oc.incentive_balance,
      p_reference_type,
      p_reference_id,
      '[PARTIAL_RELEASE] unconsumed hold remainder',
      p_performed_by,
      v_release_key,
      'release',
      p_hold_txn_id,
      'paid',
      v_release_free,
      v_release_paid,
      v_release_incentive,
      now()
    FROM organization_credits oc
    WHERE oc.organization_id = p_org_id
    RETURNING * INTO v_release;
  END IF;

  RETURN jsonb_build_object(
    'id', v_confirm.id,
    'release_id', CASE WHEN v_release_total > 0 THEN v_release.id ELSE NULL END,
    'total_consumed', v_actual_total,
    'total_released', v_release_total,
    'is_underfunded', false
  );
END;
$$;

DROP FUNCTION IF EXISTS expire_org_free_credits(uuid, int, text);

-- Expiry Category Safety Guard
--
-- Problem: apply_credit_reservation phase='expire' only touches free_balance,
-- but it silently accepts non-zero p_incentive_amount and p_paid_amount without
-- error. If a caller accidentally passes those values, the balance mutation is
-- safe (expire path ignores them) but the intent is wrong and could mask bugs.
--
-- Fix: add an explicit RAISE EXCEPTION in the expire branch so any attempt to
-- pass non-zero incentive or paid amounts to the expire path is rejected loudly
-- at the DB level — not just silently ignored.
--
-- Also adds incentive_expiry config row to free_credit_config (disabled by
-- default). When is_active=true and expiry_days is set, the expiry service will
-- process incentive credits. Guards remain: paid credits can never expire.

-- ── 0. Ensure all referenced base tables exist ───────────────────────────────
-- apply_credit_reservation uses %ROWTYPE on both tables, so PostgreSQL needs
-- them to exist at function-compilation time. CREATE TABLE IF NOT EXISTS is a
-- no-op when the table already exists, so these are safe to run on any env.

CREATE TABLE IF NOT EXISTS organization_credits (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID        NOT NULL UNIQUE,
  -- category wallets (balance_credits legacy column intentionally omitted —
  -- dropped by 20260323_remove_balance_credits.sql)
  free_balance        INTEGER     NOT NULL DEFAULT 0,
  paid_balance        INTEGER     NOT NULL DEFAULT 0,
  incentive_balance   INTEGER     NOT NULL DEFAULT 0,
  -- in-flight reservations (HOLD phase)
  reserved_free       INTEGER     NOT NULL DEFAULT 0,
  reserved_paid       INTEGER     NOT NULL DEFAULT 0,
  reserved_incentive  INTEGER     NOT NULL DEFAULT 0,
  -- lifetime counters
  lifetime_purchased  INTEGER     NOT NULL DEFAULT 0,
  lifetime_consumed   INTEGER     NOT NULL DEFAULT 0,
  credit_rate_usd     NUMERIC(10,6) NOT NULL DEFAULT 0.01,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS credit_transactions (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID        NOT NULL,
  transaction_type      TEXT        NOT NULL,
  credits_delta         INTEGER     NOT NULL DEFAULT 0,
  balance_after         INTEGER     NOT NULL DEFAULT 0,
  usd_equivalent        NUMERIC(14,6),
  reference_type        TEXT,
  reference_id          UUID,
  note                  TEXT,
  performed_by          UUID,
  idempotency_key       TEXT        UNIQUE,
  execution_phase       TEXT,
  parent_transaction_id UUID,
  category              TEXT,
  free_delta            INTEGER     NOT NULL DEFAULT 0,
  paid_delta            INTEGER     NOT NULL DEFAULT 0,
  incentive_delta       INTEGER     NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_tx_org_expiry
  ON credit_transactions(organization_id, created_at DESC);

-- ── 1. Ensure free_credit_config exists, then add incentive expiry row ───────
-- The table is created here with IF NOT EXISTS so this migration is safe to run
-- standalone, even if 20260322_domain_credit_hardening.sql has not yet been applied.

CREATE TABLE IF NOT EXISTS free_credit_config (
  category    TEXT        PRIMARY KEY,
  credits     INTEGER     NOT NULL CHECK (credits >= 0),
  expiry_days INTEGER     NULL,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO free_credit_config (category, credits, expiry_days, is_active)
VALUES ('incentive_expiry', 0, NULL, false)
ON CONFLICT (category) DO NOTHING;

-- ── 2. Rebuild apply_credit_reservation with expire-phase guard ───────────────

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
$$;

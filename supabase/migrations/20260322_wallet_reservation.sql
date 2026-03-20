-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 3 — True Wallet Reservation + Category Separation
--
-- Adds per-category balance columns and reservation columns to
-- organization_credits.  All changes are non-destructive (ADD COLUMN IF NOT
-- EXISTS) and the existing balance_credits column is kept for backward compat.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Add category + reservation columns to organization_credits ─────────────
DO $$
BEGIN
  -- Category balances
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='organization_credits' AND column_name='free_balance')
  THEN ALTER TABLE organization_credits ADD COLUMN free_balance INT NOT NULL DEFAULT 0; END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='organization_credits' AND column_name='paid_balance')
  THEN ALTER TABLE organization_credits ADD COLUMN paid_balance INT NOT NULL DEFAULT 0; END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='organization_credits' AND column_name='incentive_balance')
  THEN ALTER TABLE organization_credits ADD COLUMN incentive_balance INT NOT NULL DEFAULT 0; END IF;

  -- Reservation holds (in-flight, not yet confirmed or released)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='organization_credits' AND column_name='reserved_free')
  THEN ALTER TABLE organization_credits ADD COLUMN reserved_free INT NOT NULL DEFAULT 0; END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='organization_credits' AND column_name='reserved_paid')
  THEN ALTER TABLE organization_credits ADD COLUMN reserved_paid INT NOT NULL DEFAULT 0; END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='organization_credits' AND column_name='reserved_incentive')
  THEN ALTER TABLE organization_credits ADD COLUMN reserved_incentive INT NOT NULL DEFAULT 0; END IF;
END $$;

-- ── 2. Migrate existing balance_credits → paid_balance ────────────────────────
--      Treat all pre-existing credits as 'paid'.  Idempotent: only updates rows
--      where paid_balance has not yet been set (i.e. still 0).
UPDATE organization_credits
SET paid_balance = balance_credits
WHERE paid_balance = 0 AND balance_credits > 0;

-- ── 3. Add per-category delta columns to credit_transactions ──────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='credit_transactions' AND column_name='free_delta')
  THEN ALTER TABLE credit_transactions ADD COLUMN free_delta INT NOT NULL DEFAULT 0; END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='credit_transactions' AND column_name='paid_delta')
  THEN ALTER TABLE credit_transactions ADD COLUMN paid_delta INT NOT NULL DEFAULT 0; END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='credit_transactions' AND column_name='incentive_delta')
  THEN ALTER TABLE credit_transactions ADD COLUMN incentive_delta INT NOT NULL DEFAULT 0; END IF;
END $$;

-- ── 4. credit_usage_log — tight credit ↔ usage coupling ──────────────────────
CREATE TABLE IF NOT EXISTS credit_usage_log (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL,
  user_id               UUID,
  action                TEXT NOT NULL,
  credits_used          INT  NOT NULL,
  free_used             INT  NOT NULL DEFAULT 0,
  incentive_used        INT  NOT NULL DEFAULT 0,
  paid_used             INT  NOT NULL DEFAULT 0,
  reference_type        TEXT,
  reference_id          TEXT,
  confirm_transaction_id UUID NOT NULL,  -- FK to credit_transactions
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS credit_usage_log_org_idx
  ON credit_usage_log(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS credit_usage_log_confirm_idx
  ON credit_usage_log(confirm_transaction_id);
CREATE UNIQUE INDEX IF NOT EXISTS credit_usage_log_confirm_uniq
  ON credit_usage_log(confirm_transaction_id);  -- one usage per confirm

ALTER TABLE credit_usage_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON credit_usage_log
  FOR ALL USING (auth.role() = 'service_role');

-- ── 5. credit_expiry_log — records when free credits were expired ─────────────
CREATE TABLE IF NOT EXISTS credit_expiry_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  user_id         UUID,
  amount_expired  INT  NOT NULL,
  balance_before  INT  NOT NULL,
  balance_after   INT  NOT NULL,
  expired_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason          TEXT NOT NULL DEFAULT 'expiry'
);

CREATE INDEX IF NOT EXISTS credit_expiry_log_org_idx
  ON credit_expiry_log(organization_id, expired_at DESC);

ALTER TABLE credit_expiry_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON credit_expiry_log
  FOR ALL USING (auth.role() = 'service_role');

-- ── 6. apply_credit_reservation — category-aware HOLD / CONFIRM / RELEASE ────
--
--  Phases:
--    hold    → deduct from balance, add to reserved (serialised by FOR UPDATE)
--    confirm → deduct from reserved (no balance change)
--    release → deduct from reserved, restore to balance
--    grant   → add to specific category balance + balance_credits
--
--  Idempotency: if idempotency_key already exists → return existing row, NO-OP.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION apply_credit_reservation(
  p_org_id          UUID,
  p_phase           TEXT,         -- hold | confirm | release | grant
  p_free_amount     INT  DEFAULT 0,
  p_incentive_amount INT DEFAULT 0,
  p_paid_amount     INT  DEFAULT 0,
  p_idempotency_key TEXT DEFAULT NULL,
  p_reference_type  TEXT DEFAULT NULL,
  p_reference_id    TEXT DEFAULT NULL,
  p_note            TEXT DEFAULT NULL,
  p_performed_by    UUID DEFAULT NULL,
  p_parent_id       UUID DEFAULT NULL,
  p_category        TEXT DEFAULT 'paid'  -- for grant phase
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_existing       JSONB;
  v_new_id         UUID;
  v_total          INT := p_free_amount + p_incentive_amount + p_paid_amount;
  v_free_bal       INT;
  v_paid_bal       INT;
  v_incentive_bal  INT;
  v_tx_type        TEXT;
BEGIN

  -- 1. Idempotency check
  IF p_idempotency_key IS NOT NULL THEN
    SELECT row_to_json(t)::JSONB INTO v_existing
    FROM credit_transactions t
    WHERE idempotency_key = p_idempotency_key
    LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;
  END IF;

  -- 2. Phase-specific balance mutations (all within one transaction, row-locked)
  IF p_phase = 'hold' THEN
    v_tx_type := 'deduction';
    -- Lock row to serialise concurrent holds
    SELECT free_balance, paid_balance, incentive_balance
    INTO   v_free_bal, v_paid_bal, v_incentive_bal
    FROM   organization_credits
    WHERE  organization_id = p_org_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'no_credit_account: org %', p_org_id;
    END IF;

    -- Validate sufficient available (available = balance - reserved)
    IF v_free_bal < p_free_amount THEN
      RAISE EXCEPTION 'insufficient_free_credits: need %, have %', p_free_amount, v_free_bal;
    END IF;
    IF v_paid_bal < p_paid_amount THEN
      RAISE EXCEPTION 'insufficient_paid_credits: need %, have %', p_paid_amount, v_paid_bal;
    END IF;
    IF v_incentive_bal < p_incentive_amount THEN
      RAISE EXCEPTION 'insufficient_incentive_credits: need %, have %', p_incentive_amount, v_incentive_bal;
    END IF;

    -- Move from balance → reserved
    UPDATE organization_credits SET
      free_balance       = free_balance      - p_free_amount,
      reserved_free      = reserved_free     + p_free_amount,
      paid_balance       = paid_balance      - p_paid_amount,
      reserved_paid      = reserved_paid     + p_paid_amount,
      incentive_balance  = incentive_balance - p_incentive_amount,
      reserved_incentive = reserved_incentive + p_incentive_amount,
      balance_credits    = balance_credits   - v_total,
      updated_at         = NOW()
    WHERE organization_id = p_org_id;

  ELSIF p_phase = 'confirm' THEN
    v_tx_type := 'deduction';
    -- Move from reserved → consumed (no balance change — already done at HOLD)
    UPDATE organization_credits SET
      reserved_free      = reserved_free      - p_free_amount,
      reserved_paid      = reserved_paid      - p_paid_amount,
      reserved_incentive = reserved_incentive - p_incentive_amount,
      lifetime_consumed  = lifetime_consumed  + v_total,
      updated_at         = NOW()
    WHERE organization_id = p_org_id;

  ELSIF p_phase = 'release' THEN
    v_tx_type := 'reversal';
    -- Restore from reserved → balance
    UPDATE organization_credits SET
      free_balance       = free_balance       + p_free_amount,
      reserved_free      = reserved_free      - p_free_amount,
      paid_balance       = paid_balance       + p_paid_amount,
      reserved_paid      = reserved_paid      - p_paid_amount,
      incentive_balance  = incentive_balance  + p_incentive_amount,
      reserved_incentive = reserved_incentive - p_incentive_amount,
      balance_credits    = balance_credits    + v_total,
      updated_at         = NOW()
    WHERE organization_id = p_org_id;

  ELSIF p_phase = 'grant' THEN
    v_tx_type := 'purchase';
    -- Add to the specified category wallet
    UPDATE organization_credits SET
      free_balance      = free_balance      + p_free_amount,
      paid_balance      = paid_balance      + p_paid_amount,
      incentive_balance = incentive_balance + p_incentive_amount,
      balance_credits   = balance_credits   + v_total,
      lifetime_purchased = lifetime_purchased + v_total,
      updated_at        = NOW()
    WHERE organization_id = p_org_id;

  ELSIF p_phase = 'expire' THEN
    v_tx_type := 'deduction';
    -- Direct removal from free_balance (already checked before calling)
    UPDATE organization_credits SET
      free_balance    = free_balance    - p_free_amount,
      balance_credits = balance_credits - p_free_amount,
      updated_at      = NOW()
    WHERE organization_id = p_org_id;

  ELSE
    RAISE EXCEPTION 'unknown phase: %', p_phase;
  END IF;

  -- 3. Insert audit row in credit_transactions
  INSERT INTO credit_transactions (
    organization_id,
    transaction_type,
    credits_delta,
    balance_after,
    usd_equivalent,
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
    CASE p_phase
      WHEN 'hold'    THEN -v_total
      WHEN 'confirm' THEN -v_total
      WHEN 'release' THEN  v_total
      WHEN 'grant'   THEN  v_total
      WHEN 'expire'  THEN -p_free_amount
    END,
    oc.balance_credits,
    NULL,
    p_reference_type,
    p_reference_id::UUID,
    p_note,
    p_performed_by,
    p_idempotency_key,
    p_phase,
    p_parent_id,
    p_category,
    CASE p_phase WHEN 'release' THEN p_free_amount ELSE -p_free_amount END,
    CASE p_phase WHEN 'release' THEN p_paid_amount ELSE -p_paid_amount END,
    CASE p_phase WHEN 'release' THEN p_incentive_amount ELSE -p_incentive_amount END,
    NOW()
  FROM organization_credits oc
  WHERE oc.organization_id = p_org_id
  RETURNING id INTO v_new_id;

  RETURN (
    SELECT row_to_json(t)::JSONB
    FROM credit_transactions t
    WHERE id = v_new_id
  );

EXCEPTION
  WHEN unique_violation THEN
    -- Race: another thread wrote same idempotency_key
    RETURN (
      SELECT row_to_json(t)::JSONB
      FROM credit_transactions t
      WHERE idempotency_key = p_idempotency_key
      LIMIT 1
    );
END;
$$;

GRANT EXECUTE ON FUNCTION apply_credit_reservation TO service_role;

-- ── 7. expire_org_free_credits — called by the TypeScript expiry service ───────
CREATE OR REPLACE FUNCTION expire_org_free_credits(
  p_org_id    UUID,
  p_amount    INT,
  p_note      TEXT DEFAULT 'free credit expiry'
) RETURNS INT   -- returns amount actually expired
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_free INT;
  v_to_expire    INT;
BEGIN
  SELECT free_balance INTO v_current_free
  FROM   organization_credits
  WHERE  organization_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND OR v_current_free <= 0 THEN
    RETURN 0;
  END IF;

  v_to_expire := LEAST(p_amount, v_current_free);

  UPDATE organization_credits SET
    free_balance    = free_balance    - v_to_expire,
    balance_credits = balance_credits - v_to_expire,
    updated_at      = NOW()
  WHERE organization_id = p_org_id;

  RETURN v_to_expire;
END;
$$;

GRANT EXECUTE ON FUNCTION expire_org_free_credits TO service_role;

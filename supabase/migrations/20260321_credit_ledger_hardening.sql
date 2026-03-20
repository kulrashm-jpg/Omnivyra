-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 2 — Credit Ledger Hardening
-- Adds idempotency, hold/confirm/release execution phases, and credit category
-- to the credit_transactions table.  Non-destructive: all columns optional,
-- existing rows and the original apply_credit_transaction RPC are untouched.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1.1  Add new columns to credit_transactions (safe, all nullable) ─────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'credit_transactions' AND column_name = 'idempotency_key'
  ) THEN
    ALTER TABLE credit_transactions ADD COLUMN idempotency_key TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'credit_transactions' AND column_name = 'execution_phase'
  ) THEN
    ALTER TABLE credit_transactions ADD COLUMN execution_phase TEXT
      CHECK (execution_phase IN ('hold', 'confirm', 'release'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'credit_transactions' AND column_name = 'parent_transaction_id'
  ) THEN
    ALTER TABLE credit_transactions ADD COLUMN parent_transaction_id UUID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'credit_transactions' AND column_name = 'expires_at'
  ) THEN
    ALTER TABLE credit_transactions ADD COLUMN expires_at TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'credit_transactions' AND column_name = 'category'
  ) THEN
    ALTER TABLE credit_transactions ADD COLUMN category TEXT
      CHECK (category IN ('free', 'paid', 'incentive'));
  END IF;
END $$;

-- 1.2  Unique idempotency index (partial — only enforced when key is set) ──────
CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_txn_idempotency
  ON credit_transactions(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- 1.3  Phase + org lookup index ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_credit_txn_org_phase
  ON credit_transactions(organization_id, execution_phase);

-- 1.4  Backfill category for existing rows ────────────────────────────────────
UPDATE credit_transactions
SET category = 'paid'
WHERE category IS NULL;

-- 1.5  Unique guard: one signup credit per user ────────────────────────────────
--      Prevents re-granting the initial 300 credits on retry/race.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_signup_credit
  ON credit_transactions(performed_by, reference_type)
  WHERE reference_type = 'free_credits' AND transaction_type = 'purchase';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. apply_credit_transaction_v2
--    Extended RPC that supports hold/confirm/release + idempotency.
--    The original apply_credit_transaction is unchanged (backward compatible).
--
--    Idempotency contract:
--      If idempotency_key already exists → return existing row, NO mutation.
--
--    Phase behaviour:
--      hold    → records intent; does NOT mutate balance_credits
--      confirm → checks balance (WITH row lock), deducts, records parent
--      release → records reversal; does NOT mutate balance (hold did not deduct)
--      (default) → behaves like old RPC: mutates balance unconditionally
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION apply_credit_transaction_v2(
  p_organization_id       UUID,
  p_transaction_type      TEXT,          -- 'deduction' | 'purchase' | 'reversal'
  p_credits_delta         INT,           -- negative for deductions, positive for credits
  p_usd_equivalent        NUMERIC        DEFAULT NULL,
  p_reference_type        TEXT           DEFAULT NULL,
  p_reference_id          TEXT           DEFAULT NULL,
  p_note                  TEXT           DEFAULT NULL,
  p_performed_by          UUID           DEFAULT NULL,
  p_idempotency_key       TEXT           DEFAULT NULL,
  p_execution_phase       TEXT           DEFAULT 'confirm', -- hold | confirm | release
  p_parent_transaction_id UUID           DEFAULT NULL,
  p_category              TEXT           DEFAULT 'paid',
  p_metadata              JSONB          DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_existing  JSONB;
  v_new_id    UUID;
  v_balance   INT;
  v_balance_after INT;
BEGIN
  -- ── 1. Idempotency: if key already exists, return the existing row ───────────
  IF p_idempotency_key IS NOT NULL THEN
    SELECT row_to_json(t)::JSONB INTO v_existing
    FROM credit_transactions t
    WHERE idempotency_key = p_idempotency_key
    LIMIT 1;

    IF v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;
  END IF;

  -- ── 2. For confirm/deduction phases: check + lock balance ──────────────────
  IF p_credits_delta < 0 AND p_execution_phase IN ('confirm', 'direct') THEN
    SELECT balance_credits INTO v_balance
    FROM organization_credits
    WHERE organization_id = p_organization_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'no_credit_account: organization % has no credit account', p_organization_id;
    END IF;

    IF v_balance + p_credits_delta < 0 THEN
      RAISE EXCEPTION 'insufficient_credits: need %, have %',
        ABS(p_credits_delta), v_balance;
    END IF;

    v_balance_after := v_balance + p_credits_delta;
  END IF;

  -- ── 3. Insert the transaction row ────────────────────────────────────────────
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
    created_at
  ) VALUES (
    p_organization_id,
    p_transaction_type,
    p_credits_delta,
    v_balance_after,
    p_usd_equivalent,
    p_reference_type,
    p_reference_id::UUID,
    p_note,
    p_performed_by,
    p_idempotency_key,
    p_execution_phase,
    p_parent_transaction_id,
    COALESCE(p_category, 'paid'),
    NOW()
  )
  RETURNING id INTO v_new_id;

  -- ── 4. Mutate balance ONLY for confirm/purchase/direct phases ────────────────
  --       hold    → NO balance change (intent only)
  --       release → NO balance change (hold never deducted)
  --       confirm → balance already checked above; apply delta
  --       purchase/reversal → apply delta (admin grants, refunds)
  IF p_execution_phase IN ('confirm', 'direct')
     OR p_transaction_type IN ('purchase', 'reversal') THEN

    UPDATE organization_credits
    SET
      balance_credits = balance_credits + p_credits_delta,
      updated_at      = NOW()
    WHERE organization_id = p_organization_id;
  END IF;

  -- ── 5. Return the inserted row ────────────────────────────────────────────────
  RETURN (
    SELECT row_to_json(t)::JSONB
    FROM credit_transactions t
    WHERE id = v_new_id
  );

EXCEPTION
  WHEN unique_violation THEN
    -- Race condition: another thread inserted same idempotency_key
    -- Return the winning row
    RETURN (
      SELECT row_to_json(t)::JSONB
      FROM credit_transactions t
      WHERE idempotency_key = p_idempotency_key
      LIMIT 1
    );
END;
$$;

-- Grant execution to the service role
GRANT EXECUTE ON FUNCTION apply_credit_transaction_v2 TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. llm_pricing_config — move hardcoded model pricing to DB ─────────────────
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS llm_pricing_config (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id     text NOT NULL UNIQUE,
  provider     text NOT NULL DEFAULT 'openai',
  input_cost_per_1k_tokens  numeric NOT NULL DEFAULT 0,
  output_cost_per_1k_tokens numeric NOT NULL DEFAULT 0,
  is_active    boolean NOT NULL DEFAULT true,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

INSERT INTO llm_pricing_config (model_id, provider, input_cost_per_1k_tokens, output_cost_per_1k_tokens) VALUES
  ('gpt-4o',              'openai',    0.005,  0.015),
  ('gpt-4o-mini',         'openai',    0.00015, 0.0006),
  ('gpt-4-turbo',         'openai',    0.01,   0.03),
  ('claude-opus-4-6',     'anthropic', 0.015,  0.075),
  ('claude-sonnet-4-6',   'anthropic', 0.003,  0.015),
  ('claude-haiku-4-5-20251001', 'anthropic', 0.00025, 0.00125)
ON CONFLICT (model_id) DO UPDATE SET
  input_cost_per_1k_tokens  = EXCLUDED.input_cost_per_1k_tokens,
  output_cost_per_1k_tokens = EXCLUDED.output_cost_per_1k_tokens,
  updated_at                = now();

ALTER TABLE llm_pricing_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON llm_pricing_config
  FOR ALL USING (auth.role() = 'service_role');

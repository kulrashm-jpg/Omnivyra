-- Organization Credits System
-- Tracks credit balances and transactions for the super-admin credit pricing layer.
-- Credits are purchased by super admin, deducted on LLM/API consumption.

-- Credit balance per organization (one row per org)
CREATE TABLE IF NOT EXISTS organization_credits (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL UNIQUE,
  balance_credits     numeric(18, 6) NOT NULL DEFAULT 0 CHECK (balance_credits >= 0),
  lifetime_purchased  numeric(18, 6) NOT NULL DEFAULT 0,
  lifetime_consumed   numeric(18, 6) NOT NULL DEFAULT 0,
  credit_rate_usd     numeric(10, 6) NOT NULL DEFAULT 0.01, -- USD per 1 credit (set by super admin)
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_credits_org ON organization_credits (organization_id);

-- Append-only ledger of credit transactions
CREATE TABLE IF NOT EXISTS credit_transactions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL,
  transaction_type    text NOT NULL CHECK (transaction_type IN ('purchase','deduction','adjustment','refund')),
  credits_delta       numeric(18, 6) NOT NULL,  -- positive = add, negative = deduct
  balance_after       numeric(18, 6) NOT NULL,
  usd_equivalent      numeric(14, 6),           -- dollar value at time of transaction
  reference_type      text,                      -- 'llm_call', 'api_call', 'manual_grant', etc.
  reference_id        uuid,                      -- usage_events.id or null for manual
  note                text,
  performed_by        uuid,                      -- super admin user_id for manual ops
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_credit_tx_org        ON credit_transactions (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_tx_type       ON credit_transactions (transaction_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_tx_ref        ON credit_transactions (reference_id) WHERE reference_id IS NOT NULL;

-- Pricing plan credit rates (super admin sets these; overrides org-level rate)
ALTER TABLE pricing_plans
  ADD COLUMN IF NOT EXISTS credit_rate_usd     numeric(10,6) DEFAULT 0.01,
  ADD COLUMN IF NOT EXISTS credits_per_1k_llm_tokens numeric(10,4) DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS credits_per_api_call      numeric(10,4) DEFAULT 0.1;

-- Helper: atomically update credit balance and insert transaction row
CREATE OR REPLACE FUNCTION apply_credit_transaction(
  p_organization_id   uuid,
  p_transaction_type  text,
  p_credits_delta     numeric,
  p_usd_equivalent    numeric,
  p_reference_type    text,
  p_reference_id      uuid,
  p_note              text,
  p_performed_by      uuid
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_new_balance numeric;
  v_tx_id       uuid;
BEGIN
  -- Upsert org credit row
  INSERT INTO organization_credits (organization_id, balance_credits, lifetime_purchased, lifetime_consumed)
  VALUES (p_organization_id, 0, 0, 0)
  ON CONFLICT (organization_id) DO NOTHING;

  -- Update balance
  UPDATE organization_credits
  SET
    balance_credits    = balance_credits + p_credits_delta,
    lifetime_purchased = lifetime_purchased + GREATEST(p_credits_delta, 0),
    lifetime_consumed  = lifetime_consumed  + GREATEST(-p_credits_delta, 0),
    updated_at         = now()
  WHERE organization_id = p_organization_id
  RETURNING balance_credits INTO v_new_balance;

  -- Insert transaction row
  INSERT INTO credit_transactions (
    organization_id, transaction_type, credits_delta, balance_after,
    usd_equivalent, reference_type, reference_id, note, performed_by
  ) VALUES (
    p_organization_id, p_transaction_type, p_credits_delta, v_new_balance,
    p_usd_equivalent, p_reference_type, p_reference_id, p_note, p_performed_by
  ) RETURNING id INTO v_tx_id;

  RETURN v_tx_id;
END;
$$;

-- reconstructed from production schema (out-of-band apply)
-- aligned with schema_migrations version 20260321 (name: credit_ledger_hardening)
--
-- Phase 2 — Credit Ledger Hardening
-- Adds idempotency, hold/confirm/release execution phases, and credit category
-- to the credit_transactions table. Non-destructive: all columns nullable.
--
-- Removed from original repo content (verified absent in prod):
--   * CREATE TABLE llm_pricing_config           — never landed in prod (superseded by llm_model_pricing in 20260422101355)
--   * CREATE FUNCTION apply_credit_transaction_v2 — ephemeral, dropped by 20260323_remove_balance_credits

-- 1.1  Add new columns to credit_transactions (safe, all nullable) ─────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='credit_transactions' AND column_name='idempotency_key'
  ) THEN
    ALTER TABLE public.credit_transactions ADD COLUMN idempotency_key TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='credit_transactions' AND column_name='execution_phase'
  ) THEN
    ALTER TABLE public.credit_transactions ADD COLUMN execution_phase TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='credit_transactions' AND column_name='parent_transaction_id'
  ) THEN
    ALTER TABLE public.credit_transactions ADD COLUMN parent_transaction_id UUID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='credit_transactions' AND column_name='expires_at'
  ) THEN
    ALTER TABLE public.credit_transactions ADD COLUMN expires_at TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='credit_transactions' AND column_name='category'
  ) THEN
    ALTER TABLE public.credit_transactions ADD COLUMN category TEXT;
  END IF;
END $$;

-- 1.2  Unique idempotency index (partial — only enforced when key is set) ──────
CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_txn_idempotency
  ON public.credit_transactions(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- 1.3  Phase + org lookup index ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_credit_txn_org_phase
  ON public.credit_transactions(organization_id, execution_phase);

-- 1.4  Backfill category for existing rows (null-safe, idempotent) ────────────
UPDATE public.credit_transactions
SET category = 'paid'
WHERE category IS NULL;

-- 1.5  Unique guard: one signup credit per user ────────────────────────────────
--      Prevents re-granting the initial credits on retry/race.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_signup_credit
  ON public.credit_transactions(performed_by, reference_type)
  WHERE reference_type = 'free_credits' AND transaction_type = 'purchase';

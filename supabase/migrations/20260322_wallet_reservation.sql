-- reconstructed from production schema (out-of-band apply)
-- aligned with schema_migrations version 20260322 (name: wallet_reservation)
--
-- Phase 3 — True Wallet Reservation + Category Separation
--
-- Adds per-category balance + reservation columns to organization_credits,
-- per-category delta columns to credit_transactions, and the credit_usage_log /
-- credit_expiry_log audit tables. balance_credits column is preserved here for
-- backward compat; it is dropped by 20260323_remove_balance_credits.
--
-- Removed from original repo content:
--   * apply_credit_reservation function body — replaced wholesale by 20260323
--     and again by out-of-band updates. Final form lives in current prod;
--     creating an intermediate body here would be discarded immediately.

-- ── 1. Add category + reservation columns to organization_credits ─────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='organization_credits' AND column_name='free_balance')
  THEN ALTER TABLE public.organization_credits ADD COLUMN free_balance INT NOT NULL DEFAULT 0; END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='organization_credits' AND column_name='paid_balance')
  THEN ALTER TABLE public.organization_credits ADD COLUMN paid_balance INT NOT NULL DEFAULT 0; END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='organization_credits' AND column_name='incentive_balance')
  THEN ALTER TABLE public.organization_credits ADD COLUMN incentive_balance INT NOT NULL DEFAULT 0; END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='organization_credits' AND column_name='reserved_free')
  THEN ALTER TABLE public.organization_credits ADD COLUMN reserved_free INT NOT NULL DEFAULT 0; END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='organization_credits' AND column_name='reserved_paid')
  THEN ALTER TABLE public.organization_credits ADD COLUMN reserved_paid INT NOT NULL DEFAULT 0; END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='organization_credits' AND column_name='reserved_incentive')
  THEN ALTER TABLE public.organization_credits ADD COLUMN reserved_incentive INT NOT NULL DEFAULT 0; END IF;
END $$;

-- ── 2. Migrate existing balance_credits → paid_balance ────────────────────────
--      Treat all pre-existing credits as 'paid'. Idempotent: only touches rows
--      where paid_balance is still 0 AND balance_credits > 0. The column
--      balance_credits is dropped by the next migration; this UPDATE is a no-op
--      on replay because the column will already be gone, so it is gated.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='organization_credits' AND column_name='balance_credits')
  THEN
    EXECUTE $upd$
      UPDATE public.organization_credits
      SET paid_balance = balance_credits
      WHERE paid_balance = 0 AND balance_credits > 0
    $upd$;
  END IF;
END $$;

-- ── 3. Add per-category delta columns to credit_transactions ──────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='credit_transactions' AND column_name='free_delta')
  THEN ALTER TABLE public.credit_transactions ADD COLUMN free_delta INT NOT NULL DEFAULT 0; END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='credit_transactions' AND column_name='paid_delta')
  THEN ALTER TABLE public.credit_transactions ADD COLUMN paid_delta INT NOT NULL DEFAULT 0; END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='credit_transactions' AND column_name='incentive_delta')
  THEN ALTER TABLE public.credit_transactions ADD COLUMN incentive_delta INT NOT NULL DEFAULT 0; END IF;
END $$;

-- ── 4. credit_usage_log — tight credit ↔ usage coupling ──────────────────────
CREATE TABLE IF NOT EXISTS public.credit_usage_log (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        UUID NOT NULL,
  user_id                UUID,
  action                 TEXT NOT NULL,
  credits_used           INT  NOT NULL,
  free_used              INT  NOT NULL DEFAULT 0,
  incentive_used         INT  NOT NULL DEFAULT 0,
  paid_used              INT  NOT NULL DEFAULT 0,
  reference_type         TEXT,
  reference_id           TEXT,
  confirm_transaction_id UUID NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX        IF NOT EXISTS credit_usage_log_org_idx     ON public.credit_usage_log(organization_id, created_at DESC);
CREATE INDEX        IF NOT EXISTS credit_usage_log_confirm_idx ON public.credit_usage_log(confirm_transaction_id);
CREATE UNIQUE INDEX IF NOT EXISTS credit_usage_log_confirm_uniq ON public.credit_usage_log(confirm_transaction_id);

ALTER TABLE public.credit_usage_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='credit_usage_log' AND policyname='service_role_all')
  THEN
    CREATE POLICY "service_role_all" ON public.credit_usage_log
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- ── 5. credit_expiry_log — records when free credits were expired ─────────────
CREATE TABLE IF NOT EXISTS public.credit_expiry_log (
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
  ON public.credit_expiry_log(organization_id, expired_at DESC);

ALTER TABLE public.credit_expiry_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='credit_expiry_log' AND policyname='service_role_all')
  THEN
    CREATE POLICY "service_role_all" ON public.credit_expiry_log
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

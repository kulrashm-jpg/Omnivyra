-- Reconstructed by Phase B0 on 2026-05-03
-- Source: supabase_migrations.schema_migrations (canonical, applied via supabase db push)
-- Version: 20260422054439  Name: backfill_credit_log_tables_and_expiry_fn
-- Idempotency: GUARDED.

-- Backfill objects missing from the partial 20260322/20260323 apply:
--   1. credit_usage_log  (from 20260322)
--   2. credit_expiry_log (from 20260322)
--   3. expire_org_free_credits (post-20260323 clean version — no balance_credits write)

-- ── 1. credit_usage_log ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS credit_usage_log (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid NOT NULL,
  user_id                uuid,
  action                 text NOT NULL,
  credits_used           int  NOT NULL,
  free_used              int  NOT NULL DEFAULT 0,
  incentive_used         int  NOT NULL DEFAULT 0,
  paid_used              int  NOT NULL DEFAULT 0,
  reference_type         text,
  reference_id           text,
  confirm_transaction_id uuid NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS credit_usage_log_org_idx
  ON credit_usage_log(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS credit_usage_log_confirm_idx
  ON credit_usage_log(confirm_transaction_id);
CREATE UNIQUE INDEX IF NOT EXISTS credit_usage_log_confirm_uniq
  ON credit_usage_log(confirm_transaction_id);

ALTER TABLE credit_usage_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='credit_usage_log' AND policyname='service_role_all')
  THEN
    CREATE POLICY "service_role_all" ON credit_usage_log
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- ── 2. credit_expiry_log ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS credit_expiry_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  user_id         uuid,
  amount_expired  int  NOT NULL,
  balance_before  int  NOT NULL,
  balance_after   int  NOT NULL,
  expired_at      timestamptz NOT NULL DEFAULT now(),
  reason          text NOT NULL DEFAULT 'expiry'
);

CREATE INDEX IF NOT EXISTS credit_expiry_log_org_idx
  ON credit_expiry_log(organization_id, expired_at DESC);

ALTER TABLE credit_expiry_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='credit_expiry_log' AND policyname='service_role_all')
  THEN
    CREATE POLICY "service_role_all" ON credit_expiry_log
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- ── 3. expire_org_free_credits (post-20260323 clean version) ─────────────────
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

GRANT EXECUTE ON FUNCTION expire_org_free_credits TO service_role;

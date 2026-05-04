-- Add refund support to credit_purchases.
--
-- Required by purchaseService.refundPurchase() and the
-- /api/super-admin/chargebacks endpoint.
--
-- REPLAY-SAFE: `credit_purchases` is not in canonical baseline (it lives in
-- the ~335-table drift bucket — Phase E2..E7). On a fresh DB the table
-- doesn't yet exist, so every ALTER must be guarded by a table-existence
-- check. Once a future migration imports `credit_purchases` from
-- _quarantine/legacy_untracked, this migration will start applying.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'credit_purchases'
  ) THEN
    RAISE NOTICE 'credit_purchases not present yet — skipping refund column migration';
    RETURN;
  END IF;

  ALTER TABLE public.credit_purchases
    DROP CONSTRAINT IF EXISTS credit_purchases_status_check;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'credit_purchases_status_check'
      AND conrelid = 'public.credit_purchases'::regclass
  ) THEN
    ALTER TABLE public.credit_purchases
      ADD CONSTRAINT credit_purchases_status_check
      CHECK (status IN ('pending', 'completed', 'failed', 'refunded'));
  END IF;

  ALTER TABLE public.credit_purchases
    ADD COLUMN IF NOT EXISTS refunded_at         TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS refund_reason       TEXT        NULL,
    ADD COLUMN IF NOT EXISTS refunded_by_user_id UUID        NULL,
    ADD COLUMN IF NOT EXISTS refund_credits      INTEGER     NULL;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'credit_purchases'
  ) THEN
    EXECUTE $idx$
      CREATE INDEX IF NOT EXISTS idx_credit_purchases_refunded
        ON public.credit_purchases(refunded_at)
        WHERE refunded_at IS NOT NULL
    $idx$;
  END IF;
END $$;

-- Razorpay staging payment foundation
--
-- Sandbox-only gateway metadata. Credit fulfillment still routes through
-- credit_purchases -> purchaseService.completePurchase -> createCredit.

ALTER TABLE credit_purchases
  ADD COLUMN IF NOT EXISTS provider_order_id text,
  ADD COLUMN IF NOT EXISTS provider_mode text NOT NULL DEFAULT 'manual'
    CHECK (provider_mode IN ('manual', 'test', 'live')),
  ADD COLUMN IF NOT EXISTS amount_subunits integer,
  ADD COLUMN IF NOT EXISTS provider_payload jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_purchases_provider_order_unique
  ON credit_purchases(provider, provider_order_id)
  WHERE provider IS NOT NULL AND provider_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_credit_purchases_provider_mode_status
  ON credit_purchases(provider, provider_mode, status, fulfillment_status);

ALTER TABLE payment_provider_events
  ADD COLUMN IF NOT EXISTS provider_mode text NOT NULL DEFAULT 'test'
    CHECK (provider_mode IN ('test', 'live')),
  ADD COLUMN IF NOT EXISTS signature_valid boolean,
  ADD COLUMN IF NOT EXISTS signature_algorithm text,
  ADD COLUMN IF NOT EXISTS provider_order_id text,
  ADD COLUMN IF NOT EXISTS provider_payment_id text;

CREATE INDEX IF NOT EXISTS idx_payment_provider_events_order
  ON payment_provider_events(provider, provider_order_id, received_at DESC)
  WHERE provider_order_id IS NOT NULL;

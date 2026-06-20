-- ============================================================================
-- Pricing configuration + canonical credit packages — PREPARED, **NOT APPLIED**
-- ----------------------------------------------------------------------------
-- Phase C: Super-Admin-managed FX rates, market overrides, and plan pricing,
-- plus canonical (USD) credit_packages. Charge currency is INR only (Razorpay);
-- USD/EUR are DISPLAY-only. No Stripe, no USD/EUR charging.
--
-- Apply via the controlled billing-migration process (NOT db push). Services
-- fall back to code defaults until this is applied, so it is safe to defer.
-- ============================================================================

-- Section A/B — FX rates (units per 1 USD). USD must be 1.
CREATE TABLE IF NOT EXISTS billing_fx_rates (
  currency    text PRIMARY KEY,
  rate        numeric(14,6) NOT NULL CHECK (rate > 0),
  updated_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Section A — market overrides: explicit retail amount per (sku, currency).
-- Wins over the FX-derived value.
CREATE TABLE IF NOT EXISTS billing_price_overrides (
  sku         text NOT NULL,
  currency    text NOT NULL,
  amount      numeric(14,2) NOT NULL CHECK (amount >= 0),
  updated_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sku, currency)
);

-- Section A — founder + regular plan pricing (canonical USD), Super-Admin managed.
CREATE TABLE IF NOT EXISTS billing_plan_pricing (
  plan_key     text PRIMARY KEY,
  founder_usd  numeric(10,2) NOT NULL CHECK (founder_usd >= 0),
  regular_usd  numeric(10,2),
  active       boolean NOT NULL DEFAULT true,
  updated_by   uuid,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Section C — canonical credit_packages: stable sku + canonical USD price.
ALTER TABLE credit_packages ADD COLUMN IF NOT EXISTS sku                 text;
ALTER TABLE credit_packages ADD COLUMN IF NOT EXISTS canonical_usd_price numeric(10,2);

-- Seed canonical top-up packages. `price` keeps the resolved INR (legacy
-- fallback); the order path prefers canonical_usd_price → resolve INR via FX.
INSERT INTO credit_packages (id, name, credits, price, is_active, sku, canonical_usd_price)
VALUES
  ('0a0a0a25-0000-4000-8000-000000000250'::uuid, 'Top-up 250 credits',   250, 2520.00, true, 'topup_250',  30.00),
  ('0a0a0500-0000-4000-8000-000000000500'::uuid, 'Top-up 500 credits',   500, 4620.00, true, 'topup_500',  55.00),
  ('0a0a1000-0000-4000-8000-000000001000'::uuid, 'Top-up 1000 credits', 1000, 8400.00, true, 'topup_1000', 100.00)
ON CONFLICT (id) DO UPDATE
  SET sku = EXCLUDED.sku, canonical_usd_price = EXCLUDED.canonical_usd_price,
      credits = EXCLUDED.credits, price = EXCLUDED.price, is_active = EXCLUDED.is_active;

-- Default FX rates (Super-Admin editable).
INSERT INTO billing_fx_rates (currency, rate) VALUES
  ('USD', 1.000000), ('INR', 84.000000), ('EUR', 0.920000)
ON CONFLICT (currency) DO NOTHING;

-- Default plan pricing (canonical USD; Super-Admin editable).
INSERT INTO billing_plan_pricing (plan_key, founder_usd, regular_usd) VALUES
  ('starter', 39.00, 100.00),
  ('growth',  79.00, 200.00),
  ('business', 159.00, 400.00)
ON CONFLICT (plan_key) DO NOTHING;

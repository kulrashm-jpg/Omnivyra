-- Monetization Foundation
--
-- STEP 1: Extend pricing_plans with credits_included + validity_days
-- STEP 2: credit_packages — independent add-on credit bundles
-- STEP 4: credit_purchases — purchase ledger, gateway integration surface

-- ── STEP 1: Extend pricing_plans ─────────────────────────────────────────────

ALTER TABLE pricing_plans
  ADD COLUMN IF NOT EXISTS credits_included INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS validity_days    INTEGER NULL;  -- NULL = no expiry

-- ── STEP 2: Credit packages ───────────────────────────────────────────────────
-- Independent of plans. Users can purchase these as top-ups at any time.

CREATE TABLE IF NOT EXISTS credit_packages (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL,
  credits    INTEGER     NOT NULL CHECK (credits > 0),
  price      NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  is_active  BOOLEAN     NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_packages_active
  ON credit_packages(is_active)
  WHERE is_active = true;

-- ── STEP 4: Purchase ledger ───────────────────────────────────────────────────
-- Foundation for payment gateway integration. On status='completed' the
-- purchaseService calls createCredit(category='paid').
--
-- package_id and plan_id are mutually exclusive (one must be set).
-- reference_id holds the external payment gateway transaction ID.

CREATE TABLE IF NOT EXISTS credit_purchases (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL,
  package_id      UUID        NULL REFERENCES credit_packages(id),
  plan_id         UUID        NULL REFERENCES pricing_plans(id),
  credits         INTEGER     NOT NULL CHECK (credits > 0),
  amount_paid     NUMERIC(10,2) NOT NULL DEFAULT 0,
  currency        TEXT        NOT NULL DEFAULT 'USD',
  status          TEXT        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'completed', 'failed')),
  reference_id    TEXT        NULL,   -- payment gateway transaction ID
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT credit_purchases_source_check
    CHECK (package_id IS NOT NULL OR plan_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_credit_purchases_org
  ON credit_purchases(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_purchases_status
  ON credit_purchases(status)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_credit_purchases_reference
  ON credit_purchases(reference_id)
  WHERE reference_id IS NOT NULL;

ALTER TABLE credit_purchases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all" ON credit_purchases;
CREATE POLICY "service_role_all" ON credit_purchases
  FOR ALL USING (auth.role() = 'service_role');

ALTER TABLE credit_packages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all" ON credit_packages;
CREATE POLICY "service_role_all" ON credit_packages
  FOR ALL USING (auth.role() = 'service_role');

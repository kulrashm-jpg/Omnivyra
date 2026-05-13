-- Restore the canonical organization credit wallet table expected by the
-- hardened apply_credit_reservation/apply_credit_partial_confirm RPCs.
--
-- Some environments have the reservation RPCs from later migrations without
-- the earlier wallet-table migration, causing paid report HOLD to fail with:
--   relation "organization_credits" does not exist

CREATE TABLE IF NOT EXISTS organization_credits (
  organization_id uuid PRIMARY KEY,
  free_balance int NOT NULL DEFAULT 0 CHECK (free_balance >= 0),
  paid_balance int NOT NULL DEFAULT 0 CHECK (paid_balance >= 0),
  incentive_balance int NOT NULL DEFAULT 0 CHECK (incentive_balance >= 0),
  reserved_free int NOT NULL DEFAULT 0 CHECK (reserved_free >= 0),
  reserved_paid int NOT NULL DEFAULT 0 CHECK (reserved_paid >= 0),
  reserved_incentive int NOT NULL DEFAULT 0 CHECK (reserved_incentive >= 0),
  lifetime_purchased int NOT NULL DEFAULT 0 CHECK (lifetime_purchased >= 0),
  lifetime_consumed int NOT NULL DEFAULT 0 CHECK (lifetime_consumed >= 0),
  category text NOT NULL DEFAULT 'paid',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_organization_credits_balances
  ON organization_credits(organization_id, free_balance, paid_balance, incentive_balance);

CREATE INDEX IF NOT EXISTS idx_organization_credits_reserved
  ON organization_credits(organization_id, reserved_free, reserved_paid, reserved_incentive)
  WHERE reserved_free > 0 OR reserved_paid > 0 OR reserved_incentive > 0;

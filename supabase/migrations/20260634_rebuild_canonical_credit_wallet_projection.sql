-- Rebuild/repair the canonical organization credit wallet projection.
--
-- The reservation RPCs use organization_credits as the transactional wallet
-- projection while credit_transactions remains the append-only ledger record.
-- Some environments received the hardened reservation RPCs without the wallet
-- projection table, causing HOLD failures:
--   relation "organization_credits" does not exist
--
-- This migration is idempotent and projection-safe:
--   1. create the table if missing
--   2. ensure all required columns exist
--   3. seed missing org rows from credit_transactions
--   4. rebuild every wallet row from ledger deltas

CREATE TABLE IF NOT EXISTS public.organization_credits (
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

ALTER TABLE public.organization_credits
  ADD COLUMN IF NOT EXISTS free_balance int NOT NULL DEFAULT 0 CHECK (free_balance >= 0),
  ADD COLUMN IF NOT EXISTS paid_balance int NOT NULL DEFAULT 0 CHECK (paid_balance >= 0),
  ADD COLUMN IF NOT EXISTS incentive_balance int NOT NULL DEFAULT 0 CHECK (incentive_balance >= 0),
  ADD COLUMN IF NOT EXISTS reserved_free int NOT NULL DEFAULT 0 CHECK (reserved_free >= 0),
  ADD COLUMN IF NOT EXISTS reserved_paid int NOT NULL DEFAULT 0 CHECK (reserved_paid >= 0),
  ADD COLUMN IF NOT EXISTS reserved_incentive int NOT NULL DEFAULT 0 CHECK (reserved_incentive >= 0),
  ADD COLUMN IF NOT EXISTS lifetime_purchased int NOT NULL DEFAULT 0 CHECK (lifetime_purchased >= 0),
  ADD COLUMN IF NOT EXISTS lifetime_consumed int NOT NULL DEFAULT 0 CHECK (lifetime_consumed >= 0),
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'paid',
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

INSERT INTO public.organization_credits (organization_id)
SELECT DISTINCT organization_id
FROM public.credit_transactions
WHERE organization_id IS NOT NULL
ON CONFLICT (organization_id) DO NOTHING;

WITH ledger AS (
  SELECT
    organization_id,
    GREATEST(
      COALESCE(SUM(CASE WHEN execution_phase = 'grant' THEN ABS(COALESCE(free_delta, 0)) ELSE 0 END), 0)
      - COALESCE(SUM(CASE WHEN execution_phase = 'hold' THEN ABS(COALESCE(free_delta, 0)) ELSE 0 END), 0)
      + COALESCE(SUM(CASE WHEN execution_phase = 'release' THEN ABS(COALESCE(free_delta, 0)) ELSE 0 END), 0)
      - COALESCE(SUM(CASE WHEN execution_phase = 'confirm' THEN ABS(COALESCE(free_delta, 0)) ELSE 0 END), 0)
      - COALESCE(SUM(CASE WHEN execution_phase = 'expire' THEN ABS(COALESCE(free_delta, 0)) ELSE 0 END), 0),
      0
    )::int AS free_balance,
    GREATEST(
      COALESCE(SUM(CASE WHEN execution_phase = 'grant' THEN ABS(COALESCE(paid_delta, 0)) ELSE 0 END), 0)
      - COALESCE(SUM(CASE WHEN execution_phase = 'hold' THEN ABS(COALESCE(paid_delta, 0)) ELSE 0 END), 0)
      + COALESCE(SUM(CASE WHEN execution_phase = 'release' THEN ABS(COALESCE(paid_delta, 0)) ELSE 0 END), 0)
      - COALESCE(SUM(CASE WHEN execution_phase = 'confirm' THEN ABS(COALESCE(paid_delta, 0)) ELSE 0 END), 0),
      0
    )::int AS paid_balance,
    GREATEST(
      COALESCE(SUM(CASE WHEN execution_phase = 'grant' THEN ABS(COALESCE(incentive_delta, 0)) ELSE 0 END), 0)
      - COALESCE(SUM(CASE WHEN execution_phase = 'hold' THEN ABS(COALESCE(incentive_delta, 0)) ELSE 0 END), 0)
      + COALESCE(SUM(CASE WHEN execution_phase = 'release' THEN ABS(COALESCE(incentive_delta, 0)) ELSE 0 END), 0)
      - COALESCE(SUM(CASE WHEN execution_phase = 'confirm' THEN ABS(COALESCE(incentive_delta, 0)) ELSE 0 END), 0)
      - COALESCE(SUM(CASE WHEN execution_phase = 'expire_incentive' THEN ABS(COALESCE(incentive_delta, 0)) ELSE 0 END), 0),
      0
    )::int AS incentive_balance,
    GREATEST(
      COALESCE(SUM(CASE WHEN execution_phase = 'hold' THEN ABS(COALESCE(free_delta, 0)) ELSE 0 END), 0)
      - COALESCE(SUM(CASE WHEN execution_phase = 'release' THEN ABS(COALESCE(free_delta, 0)) ELSE 0 END), 0)
      - COALESCE(SUM(CASE WHEN execution_phase = 'confirm' THEN ABS(COALESCE(free_delta, 0)) ELSE 0 END), 0),
      0
    )::int AS reserved_free,
    GREATEST(
      COALESCE(SUM(CASE WHEN execution_phase = 'hold' THEN ABS(COALESCE(paid_delta, 0)) ELSE 0 END), 0)
      - COALESCE(SUM(CASE WHEN execution_phase = 'release' THEN ABS(COALESCE(paid_delta, 0)) ELSE 0 END), 0)
      - COALESCE(SUM(CASE WHEN execution_phase = 'confirm' THEN ABS(COALESCE(paid_delta, 0)) ELSE 0 END), 0),
      0
    )::int AS reserved_paid,
    GREATEST(
      COALESCE(SUM(CASE WHEN execution_phase = 'hold' THEN ABS(COALESCE(incentive_delta, 0)) ELSE 0 END), 0)
      - COALESCE(SUM(CASE WHEN execution_phase = 'release' THEN ABS(COALESCE(incentive_delta, 0)) ELSE 0 END), 0)
      - COALESCE(SUM(CASE WHEN execution_phase = 'confirm' THEN ABS(COALESCE(incentive_delta, 0)) ELSE 0 END), 0),
      0
    )::int AS reserved_incentive,
    COALESCE(SUM(CASE WHEN execution_phase = 'grant' THEN ABS(COALESCE(free_delta, 0)) + ABS(COALESCE(paid_delta, 0)) + ABS(COALESCE(incentive_delta, 0)) ELSE 0 END), 0)::int AS lifetime_purchased,
    COALESCE(SUM(CASE WHEN execution_phase = 'confirm' THEN ABS(COALESCE(free_delta, 0)) + ABS(COALESCE(paid_delta, 0)) + ABS(COALESCE(incentive_delta, 0)) ELSE 0 END), 0)::int AS lifetime_consumed
  FROM public.credit_transactions
  WHERE organization_id IS NOT NULL
  GROUP BY organization_id
)
UPDATE public.organization_credits oc
SET
  free_balance = ledger.free_balance,
  paid_balance = ledger.paid_balance,
  incentive_balance = ledger.incentive_balance,
  reserved_free = ledger.reserved_free,
  reserved_paid = ledger.reserved_paid,
  reserved_incentive = ledger.reserved_incentive,
  lifetime_purchased = ledger.lifetime_purchased,
  lifetime_consumed = ledger.lifetime_consumed,
  updated_at = now()
FROM ledger
WHERE oc.organization_id = ledger.organization_id;

CREATE INDEX IF NOT EXISTS idx_organization_credits_balances
  ON public.organization_credits(organization_id, free_balance, paid_balance, incentive_balance);

CREATE INDEX IF NOT EXISTS idx_organization_credits_reserved
  ON public.organization_credits(organization_id, reserved_free, reserved_paid, reserved_incentive)
  WHERE reserved_free > 0 OR reserved_paid > 0 OR reserved_incentive > 0;

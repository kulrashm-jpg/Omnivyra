-- Prevent duplicate purchase processing from payment gateway retries.
--
-- The payment gateway sends `reference_id` (its own transaction ID) with each
-- webhook. Without a UNIQUE constraint, a gateway retry that creates a second
-- credit_purchases row with the same reference_id could be processed twice,
-- double-crediting the organization.
--
-- Solution: partial UNIQUE index on reference_id for non-NULL values.
-- NULL is allowed because internal/manual purchases may not have a gateway ID.
--
-- Also replaces the plain (non-unique) index added in the previous migration.

-- ── 1. Drop the non-unique index (replaced below) ────────────────────────────

DROP INDEX IF EXISTS idx_credit_purchases_reference;

-- ── 2. UNIQUE partial index — one row per gateway reference_id ───────────────
-- Prevents the gateway from creating two completed rows for the same payment.
-- A pending row with a given reference_id can still exist if we pre-create the
-- row before redirecting the user to the gateway — INSERT will succeed because
-- only one row with that reference_id is permitted and a second INSERT will fail.

CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_purchases_reference_unique
  ON credit_purchases(reference_id)
  WHERE reference_id IS NOT NULL;

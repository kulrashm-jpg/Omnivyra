-- ============================================================================
-- Founding Member Program — schema (PREPARED, **NOT APPLIED**)
-- ----------------------------------------------------------------------------
-- ⚠ NOT APPLIED. Follow the controlled billing-migration process (same posture
--   as 20260714–20260719). Additive + idempotent; safe to apply when ready.
--   This file only stores Founding Member status — it does NOT change pricing,
--   credits, the ledger, or any deduction/allocation behavior.
--
-- Stores Founding Member enrollment on the org's active plan assignment:
--   founding_member       — bool, true once enrolled (subscribed before expiry)
--   founding_enrolled_at  — when the org enrolled
--   founding_price_expiry — program expiry (March 2028); pricing preserved until
--                           this date through the program period
-- ============================================================================

ALTER TABLE IF EXISTS organization_plan_assignments
  ADD COLUMN IF NOT EXISTS founding_member       boolean      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS founding_enrolled_at  timestamptz  NULL,
  ADD COLUMN IF NOT EXISTS founding_price_expiry timestamptz  NULL;

-- Lookup of active founding members (admin visibility).
CREATE INDEX IF NOT EXISTS idx_org_plan_assignments_founding
  ON organization_plan_assignments (founding_member)
  WHERE founding_member = true;

COMMENT ON COLUMN organization_plan_assignments.founding_member IS
  'Founding Member: enrolled by subscribing before founding_price_expiry; pricing preserved through the program period.';

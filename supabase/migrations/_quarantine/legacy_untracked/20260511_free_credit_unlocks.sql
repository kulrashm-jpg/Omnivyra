-- =============================================================================
-- Free Credit Unlocks Schema
--
-- Implements the two-tier free-credit model:
--   Tier 1 (initial)  —  50 credits granted on onboarding (see free_credit_claims.category='initial')
--   Tier 2 (unlock)   — 250 remaining credits held pending, granted when ANY of:
--                         (a) usage ≥ 3 key actions   → unlock_reason='usage'
--                         (b) user-sent invite is accepted → unlock_reason='invite_accepted'
--                         (c) 24h elapsed since onboarding → unlock_reason='time_delay'
--
-- Idempotency is enforced at THREE layers:
--   1. UNIQUE(user_id)             — one pending row per user
--   2. CHECK status                — transitions only pending → unlocked (or expired)
--   3. free_credit_claims.UNIQUE(user_id, category='unlock') — the downstream claim row
--   4. credit_transactions.idempotency_key — the ledger entry itself
-- Any retry that reaches unlockRemainingCredits() after a successful unlock is a no-op.
-- =============================================================================

CREATE TABLE IF NOT EXISTS free_credit_unlocks (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid        NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id    uuid        NOT NULL,
  remaining_credits  integer     NOT NULL CHECK (remaining_credits > 0),

  status             text        NOT NULL DEFAULT 'pending'
                                 CHECK (status IN ('pending', 'unlocked', 'expired')),
  unlock_reason      text        CHECK (unlock_reason IN ('usage', 'invite_accepted', 'time_delay')),

  pending_since      timestamptz NOT NULL DEFAULT now(),
  unlocked_at        timestamptz,
  expires_at         timestamptz NOT NULL,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  -- If unlocked, reason and timestamp must both be set. If not unlocked, both must be null.
  CONSTRAINT fcu_unlock_fields_consistent CHECK (
    (status = 'unlocked' AND unlock_reason IS NOT NULL AND unlocked_at IS NOT NULL)
    OR
    (status <> 'unlocked' AND unlock_reason IS NULL AND unlocked_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_fcu_user_id          ON free_credit_unlocks(user_id);
CREATE INDEX IF NOT EXISTS idx_fcu_org_id           ON free_credit_unlocks(organization_id);
CREATE INDEX IF NOT EXISTS idx_fcu_status           ON free_credit_unlocks(status);

-- Composite index used by the 24h cron sweep — finds pending rows past the delay fast.
CREATE INDEX IF NOT EXISTS idx_fcu_pending_since    ON free_credit_unlocks(status, pending_since)
  WHERE status = 'pending';

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_free_credit_unlock_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fcu_updated_at ON free_credit_unlocks;
CREATE TRIGGER trg_fcu_updated_at
  BEFORE UPDATE ON free_credit_unlocks
  FOR EACH ROW EXECUTE FUNCTION update_free_credit_unlock_timestamp();

-- RLS: service-role only (grants run server-side; users don't need direct read).
ALTER TABLE free_credit_unlocks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fcu_select_own ON free_credit_unlocks;
CREATE POLICY fcu_select_own ON free_credit_unlocks FOR SELECT USING (auth.uid() = user_id);

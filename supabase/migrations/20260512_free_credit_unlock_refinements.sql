-- =============================================================================
-- Free-Credit Unlock Refinements
--
-- Tightens the tier-2 unlock flow with:
--   1. Per-user eligibility gate (eligible_after) honored by every trigger
--   2. Deferred invite trigger (requires invitee action or 10-min-old account)
--   3. Soft IP-abuse delay (>2 orgs per IP in 24h → +24h to eligible_after)
--   4. Append-only audit log (free_credit_events) for every credit lifecycle event
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. eligible_after — the earliest timestamp at which ANY unlock trigger may fire.
--    Defaults to pending_since; IP-abuse detection may bump it by +24h.
--    Backfills existing rows to pending_since for a clean cutover.
-- ---------------------------------------------------------------------------
ALTER TABLE free_credit_unlocks
  ADD COLUMN IF NOT EXISTS eligible_after timestamptz NOT NULL DEFAULT now();

UPDATE free_credit_unlocks
  SET eligible_after = pending_since
  WHERE eligible_after > pending_since;

CREATE INDEX IF NOT EXISTS idx_fcu_eligible_after
  ON free_credit_unlocks(eligible_after)
  WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- 2. free_credit_events — append-only credit lifecycle audit log.
--    Single source of truth for "what happened with this user's free credits".
--    event_type is free-form text (not enum) to avoid future migrations for
--    new event variants; known values:
--      initial_granted | pending_created | unlocked | unlock_blocked
--      expired | abuse_delay_applied | invite_deferred | invite_resolved
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS free_credit_events (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        NOT NULL,
  organization_id   uuid,
  event_type        text        NOT NULL,
  credits_delta     integer,
  reason            text,
  metadata          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  occurred_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fce_user_id     ON free_credit_events(user_id);
CREATE INDEX IF NOT EXISTS idx_fce_occurred    ON free_credit_events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_fce_event_type  ON free_credit_events(event_type);
CREATE INDEX IF NOT EXISTS idx_fce_org_id      ON free_credit_events(organization_id);

ALTER TABLE free_credit_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fce_select_own ON free_credit_events;
CREATE POLICY fce_select_own ON free_credit_events FOR SELECT USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 3. pending_invite_unlocks — deferred invite-trigger queue.
--    Populated by /api/team/accept-invite; resolved by the cron when
--    (invitee has >= 1 feature completion) OR (invitee users.created_at >= 10 min old).
--    UNIQUE(inviter_id, invitee_id) prevents double-insert from replayed accepts.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pending_invite_unlocks (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  inviter_id   uuid        NOT NULL,
  invitee_id   uuid        NOT NULL,
  accepted_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz,
  resolution   text        CHECK (resolution IN ('unlocked', 'cancelled')),

  CONSTRAINT piu_inviter_invitee_unique UNIQUE (inviter_id, invitee_id)
);

-- Partial index for the cron sweep — only unresolved rows need scanning.
CREATE INDEX IF NOT EXISTS idx_piu_unresolved
  ON pending_invite_unlocks(accepted_at)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_piu_invitee  ON pending_invite_unlocks(invitee_id);

-- ---------------------------------------------------------------------------
-- 4. ip_org_creations — IP → org-creation log for soft abuse control.
--    Row inserted at every org creation during onboarding. When more than 2
--    orgs are created from the same IP inside 24h, the tier-2 unlock's
--    eligible_after is bumped by +24h. Rows older than 30 days can be pruned.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ip_org_creations (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ip                inet        NOT NULL,
  user_id           uuid        NOT NULL,
  organization_id   uuid        NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ioc_ip_created ON ip_org_creations(ip, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ioc_created    ON ip_org_creations(created_at DESC);

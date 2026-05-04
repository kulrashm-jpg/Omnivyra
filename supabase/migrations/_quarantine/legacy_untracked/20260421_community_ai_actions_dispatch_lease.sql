-- =============================================================================
-- Phase X — Browser-runtime command dispatch lease
--
-- Adds per-row lease so two extension service workers polling concurrently
-- cannot both fetch and execute the same browser-assisted command.
--
-- /api/extension/commands claims rows with a CAS on dispatch_lease_expires_at
-- so only one poll wins each command. Lease TTL (90s) is longer than the
-- extension's handler timeout + retries.
-- =============================================================================

ALTER TABLE community_ai_actions
  ADD COLUMN IF NOT EXISTS dispatch_lease_id         text,
  ADD COLUMN IF NOT EXISTS dispatch_lease_expires_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_community_ai_actions_dispatch_pending
  ON community_ai_actions (organization_id, status, execution_mode, dispatch_lease_expires_at)
  WHERE status = 'pending' AND execution_mode = 'browser';

COMMENT ON COLUMN community_ai_actions.dispatch_lease_id         IS 'Random id of the /api/extension/commands claimant; null when unclaimed.';
COMMENT ON COLUMN community_ai_actions.dispatch_lease_expires_at IS 'Lease expiry timestamp; after this, any poll may re-claim the row.';

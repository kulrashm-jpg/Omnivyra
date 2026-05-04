-- =============================================================================
-- Community AI Execution Engine — phase 2 hardening
--
-- 1. Add 'acknowledged' to the canonical status set (DISPATCHED → ACKNOWLEDGED
--    → EXECUTING) so the backend can tell "claim survived the network round
--    trip" apart from "command was simply polled".
-- 2. Add `dispatch_acknowledged_at` timestamp.
-- 3. Replace the reaper so it:
--      - reaps stale `pending` + `browser` rows (lease expired with no ack)
--      - reaps stuck `dispatched`/`acknowledged` rows (lease expired)
--      - reaps stuck `executing` rows older than 2 minutes
--      - NEVER touches terminal statuses (executed / sent_unverified / failed /
--        skipped / blocked)
-- =============================================================================

BEGIN;

-- ── 1. Extend status CHECK with 'acknowledged' ──────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'community_ai_actions_status_check'
  ) THEN
    ALTER TABLE community_ai_actions
      DROP CONSTRAINT community_ai_actions_status_check;
  END IF;

  ALTER TABLE community_ai_actions
    ADD CONSTRAINT community_ai_actions_status_check
    CHECK (status IN (
      'pending',
      'approved',
      'dispatched',
      'acknowledged',
      'executing',
      'executed',
      'sent_unverified',
      'failed',
      'skipped',
      'blocked',
      'scheduled'
    ));
END $$;

-- ── 2. dispatch_acknowledged_at ─────────────────────────────────────────────
ALTER TABLE community_ai_actions
  ADD COLUMN IF NOT EXISTS dispatch_acknowledged_at timestamptz;

COMMENT ON COLUMN community_ai_actions.dispatch_acknowledged_at IS
  'Set when the extension acks claim receipt. Used to distinguish "claimed '
  'but never received" (no ack) from "claimed and in-flight" (acked).';

-- ── 3. Reaper: extended to handle stuck executing + dispatched ──────────────
CREATE OR REPLACE FUNCTION reap_community_ai_action_leases()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_reaped_pending      integer := 0;
  v_reaped_dispatched   integer := 0;
  v_reaped_executing    integer := 0;
  v_lease_cleared       integer := 0;
BEGIN
  -- 3a. Browser-dispatch rows whose lease expired before an ack.
  --     Only processes `pending` rows (the state commands.ts reads from).
  WITH reaped AS (
    UPDATE community_ai_actions
    SET    status                    = 'failed',
           execution_result           = jsonb_build_object(
             'source',       'lease_reaper',
             'error_code',   'DISPATCH_LEASE_EXPIRED',
             'error_message','No extension ack before dispatch_lease_expires_at.'
           ),
           dispatch_lease_id          = NULL,
           dispatch_lease_expires_at  = NULL,
           dispatch_lease_holder_id   = NULL,
           dispatch_acknowledged_at   = NULL,
           updated_at                 = NOW()
    WHERE  status                    = 'pending'
      AND  execution_mode            = 'browser'
      AND  dispatch_lease_expires_at IS NOT NULL
      AND  dispatch_lease_expires_at < NOW()
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_reaped_pending FROM reaped;

  -- 3b. `dispatched` / `acknowledged` rows whose lease expired while the
  --     extension was executing. Treat as failure; the extension may still
  --     complete the action platform-side (duplication is possible but rare).
  WITH reaped AS (
    UPDATE community_ai_actions
    SET    status                    = 'failed',
           execution_result           = jsonb_build_object(
             'source',       'lease_reaper',
             'error_code',   'DISPATCH_LEASE_EXPIRED_IN_FLIGHT',
             'error_message','Lease expired while command was in-flight on extension.'
           ),
           dispatch_lease_id          = NULL,
           dispatch_lease_expires_at  = NULL,
           dispatch_lease_holder_id   = NULL,
           dispatch_acknowledged_at   = NULL,
           updated_at                 = NOW()
    WHERE  status IN ('dispatched', 'acknowledged')
      AND  dispatch_lease_expires_at IS NOT NULL
      AND  dispatch_lease_expires_at < NOW()
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_reaped_dispatched FROM reaped;

  -- 3c. `executing` rows older than 2 minutes: synchronous executors (api/rpa
  --     branches) may have died mid-flight. Anything older is assumed lost.
  WITH reaped AS (
    UPDATE community_ai_actions
    SET    status           = 'failed',
           execution_result = jsonb_build_object(
             'source',       'lease_reaper',
             'error_code',   'EXECUTING_TIMEOUT',
             'error_message','Row stuck in executing > 2 minutes.'
           ),
           updated_at       = NOW()
    WHERE  status = 'executing'
      AND  updated_at < NOW() - INTERVAL '2 minutes'
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_reaped_executing FROM reaped;

  -- 3d. Defensive cleanup: terminal rows that still carry lease metadata.
  --     EXPLICITLY excludes executed / sent_unverified / failed / skipped /
  --     blocked from any status change — only lease fields are nulled.
  WITH cleared AS (
    UPDATE community_ai_actions
    SET    dispatch_lease_id         = NULL,
           dispatch_lease_expires_at = NULL,
           dispatch_lease_holder_id  = NULL,
           dispatch_acknowledged_at  = NULL
    WHERE  status IN ('executed', 'sent_unverified', 'failed', 'skipped', 'blocked')
      AND  (dispatch_lease_id IS NOT NULL
         OR dispatch_lease_expires_at IS NOT NULL
         OR dispatch_lease_holder_id IS NOT NULL
         OR dispatch_acknowledged_at IS NOT NULL)
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_lease_cleared FROM cleared;

  RETURN jsonb_build_object(
    'reaped_pending',    v_reaped_pending,
    'reaped_dispatched', v_reaped_dispatched,
    'reaped_executing',  v_reaped_executing,
    'lease_cleared',     v_lease_cleared,
    'reaped_at',         NOW()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION reap_community_ai_action_leases TO service_role;

COMMIT;

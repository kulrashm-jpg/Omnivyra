-- =============================================================================
-- Community AI Execution Engine — correctness / safety / integrity hardening
--
-- 1. Canonical status set + CHECK constraint
-- 2. approved_at integrity gate for requires_human_approval actions
-- 3. dispatch_lease_holder_id column (only the claiming session may ack)
-- 4. idempotency_key column with (organization_id, idempotency_key) UNIQUE
-- 5. playbook_id FK (orphan-safe via ON DELETE SET NULL)
-- 6. Stale-lease reaper function (pending rows past lease expiry -> failed)
--
-- Notes:
--  - All adds are IF NOT EXISTS / DO-blocks so migration is idempotent.
--  - The status CHECK is applied only after legacy rows are normalized so
--    historical statuses do not fail the constraint install.
-- =============================================================================

BEGIN;

-- ── 1. Normalize any legacy status values to the canonical set ───────────────
UPDATE community_ai_actions
SET    status = 'blocked'
WHERE  status = 'blocked_plan_limit';

UPDATE community_ai_actions
SET    status = 'failed'
WHERE  status IS NULL;

-- ── 2. Status CHECK constraint (canonical state machine) ─────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'community_ai_actions_status_check'
  ) THEN
    ALTER TABLE community_ai_actions
      ADD CONSTRAINT community_ai_actions_status_check
      CHECK (status IN (
        'pending',
        'approved',
        'dispatched',
        'executing',
        'executed',
        'sent_unverified',
        'failed',
        'skipped',
        'blocked',
        'scheduled'
      ));
  END IF;
END $$;

-- ── 3. Approval integrity ────────────────────────────────────────────────────
-- Any action flagged as requires_human_approval must carry an approved_at
-- timestamp before it can leave 'pending'. We express this as a CHECK that
-- is vacuously true for pending rows and enforces approved_at on all other
-- states. NOT VALID so legacy rows are not rewritten; new writes are checked.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'community_ai_actions_approval_integrity_check'
  ) THEN
    ALTER TABLE community_ai_actions
      ADD CONSTRAINT community_ai_actions_approval_integrity_check
      CHECK (
        requires_human_approval IS NOT TRUE
        OR status = 'pending'
        OR status = 'skipped'
        OR approved_at IS NOT NULL
      ) NOT VALID;
  END IF;
END $$;

-- ── 4. Dispatch lease holder id ──────────────────────────────────────────────
ALTER TABLE community_ai_actions
  ADD COLUMN IF NOT EXISTS dispatch_lease_holder_id text;

COMMENT ON COLUMN community_ai_actions.dispatch_lease_holder_id IS
  'Stable id (derived from extension session hmac nonce) of the session that '
  'currently holds the lease. Only this holder may ack via /action-result.';

-- ── 5. Idempotency key (optional on insert, enforced unique when present) ────
ALTER TABLE community_ai_actions
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_community_ai_actions_org_idempotency_key
  ON community_ai_actions (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN community_ai_actions.idempotency_key IS
  'Client-supplied dedupe key, scoped to (organization_id). Unique when set.';

-- ── 6. playbook_id FK (orphan safety) ────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='community_ai_playbooks')
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conname = 'community_ai_actions_playbook_fk'
     )
  THEN
    ALTER TABLE community_ai_actions
      ADD CONSTRAINT community_ai_actions_playbook_fk
      FOREIGN KEY (playbook_id)
      REFERENCES community_ai_playbooks (id)
      ON DELETE SET NULL
      NOT VALID;
  END IF;
END $$;

-- ── 7. Stale-lease reaper ────────────────────────────────────────────────────
-- Call from the cron layer on a short cadence. Transitions pending rows whose
-- lease expired without an ack to 'failed', and clears all lease fields on
-- terminal states so executed rows never leak stale lease metadata.
CREATE OR REPLACE FUNCTION reap_community_ai_action_leases()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_reaped integer := 0;
BEGIN
  WITH expired AS (
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
           updated_at                 = NOW()
    WHERE  status                    = 'pending'
      AND  execution_mode            = 'browser'
      AND  dispatch_lease_expires_at IS NOT NULL
      AND  dispatch_lease_expires_at < NOW()
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_reaped FROM expired;

  -- Defensive: clear lease fields on any row already in a terminal state.
  UPDATE community_ai_actions
  SET    dispatch_lease_id         = NULL,
         dispatch_lease_expires_at = NULL,
         dispatch_lease_holder_id  = NULL
  WHERE  status IN ('executed', 'sent_unverified', 'failed', 'skipped', 'blocked')
    AND  (dispatch_lease_id IS NOT NULL
       OR dispatch_lease_expires_at IS NOT NULL
       OR dispatch_lease_holder_id IS NOT NULL);

  RETURN v_reaped;
END;
$$;

GRANT EXECUTE ON FUNCTION reap_community_ai_action_leases TO service_role;

COMMIT;

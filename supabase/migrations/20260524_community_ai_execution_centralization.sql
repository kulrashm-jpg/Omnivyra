-- =============================================================================
-- Community AI Execution Engine — phase 3 centralization
--
-- 1. `execution_correlation_id` — one UUID spans the full lifecycle
--    (execute → dispatch → ack → result) so logs, row writes, and metric
--    events can be joined end-to-end.
-- 2. `community_ai_execution_metric_events` — lightweight per-event counter
--    log used by the executor and the reaper. Replaces scattered state
--    derivation with a single auditable stream.
-- 3. Trigger `enforce_community_ai_executor_writes` — rejects terminal
--    transitions (executed / sent_unverified) that do not carry a
--    correlation id, forcing all such writes to originate from the executor.
--    Reaper-sourced failures bypass via the `lease_reaper` marker in
--    execution_result; a superuser-only GUC provides an emergency hatch.
-- 4. Reaper upgrade: stamps a correlation id on every reaped row and
--    emits `lease_expired` metric events.
-- =============================================================================

BEGIN;

-- ── 1. execution_correlation_id column ───────────────────────────────────────
ALTER TABLE community_ai_actions
  ADD COLUMN IF NOT EXISTS execution_correlation_id uuid;

CREATE INDEX IF NOT EXISTS idx_community_ai_actions_correlation_id
  ON community_ai_actions (execution_correlation_id)
  WHERE execution_correlation_id IS NOT NULL;

COMMENT ON COLUMN community_ai_actions.execution_correlation_id IS
  'Correlation id issued by the executor at the start of execution. Joins '
  'action row ↔ logs ↔ metric events ↔ extension payload.';

-- ── 2. community_ai_execution_metric_events ─────────────────────────────────
CREATE TABLE IF NOT EXISTS community_ai_execution_metric_events (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL,
  action_id             uuid,
  correlation_id        uuid,
  event_type            text NOT NULL
                          CHECK (event_type IN (
                            'execution_started',
                            'execution_success',
                            'execution_failed',
                            'fallback_triggered',
                            'lease_expired',
                            'ack_received'
                          )),
  platform              text,
  action_type           text,
  execution_mode        text,
  metadata              jsonb,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_caime_org_created_at
  ON community_ai_execution_metric_events (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_caime_event_type_created_at
  ON community_ai_execution_metric_events (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_caime_correlation
  ON community_ai_execution_metric_events (correlation_id)
  WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_caime_action
  ON community_ai_execution_metric_events (action_id)
  WHERE action_id IS NOT NULL;

ALTER TABLE community_ai_execution_metric_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'community_ai_execution_metric_events'
      AND policyname = 'service_role_all'
  ) THEN
    CREATE POLICY "service_role_all" ON community_ai_execution_metric_events
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- ── 3. Executor-only write enforcement trigger ──────────────────────────────
-- Fires on UPDATE. Rejects transitions into `executed` / `sent_unverified`
-- unless the row carries an execution_correlation_id OR is clearly a system
-- action (reaper-sourced failure). The emergency hatch is a superuser GUC
-- `app.communityai_bypass_guard = 'yes'`.
CREATE OR REPLACE FUNCTION enforce_community_ai_executor_writes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_bypass text;
  v_source text;
BEGIN
  -- Bypass when explicitly set (emergency DBA intervention).
  BEGIN
    v_bypass := current_setting('app.communityai_bypass_guard', true);
  EXCEPTION WHEN OTHERS THEN
    v_bypass := NULL;
  END;
  IF v_bypass = 'yes' THEN
    RETURN NEW;
  END IF;

  -- Only enforce on status transitions. Lease-only updates (e.g. the
  -- `dispatched → acknowledged` transition) are allowed without a
  -- correlation id because the correlation id is set by the executor at
  -- creation time and propagates with the row.
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- Terminal success transitions require executor provenance.
  IF NEW.status IN ('executed', 'sent_unverified') THEN
    IF NEW.execution_correlation_id IS NULL THEN
      RAISE EXCEPTION 'executor_only_write: transition to % requires execution_correlation_id (actionId=%)',
        NEW.status, NEW.id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Terminal `failed` transitions require EITHER a correlation id OR an
  -- explicit system source. This lets the reaper / DB-side safety jobs
  -- transition rows without a caller context.
  IF NEW.status = 'failed' THEN
    v_source := COALESCE(NEW.execution_result->>'source', '');
    IF NEW.execution_correlation_id IS NULL AND v_source NOT IN ('lease_reaper', 'executor') THEN
      RAISE EXCEPTION 'executor_only_write: transition to failed requires execution_correlation_id OR execution_result.source in (lease_reaper, executor) (actionId=%)',
        NEW.id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_community_ai_executor_writes
  ON community_ai_actions;

CREATE TRIGGER trg_enforce_community_ai_executor_writes
  BEFORE UPDATE ON community_ai_actions
  FOR EACH ROW
  EXECUTE FUNCTION enforce_community_ai_executor_writes();

-- ── 4. Reaper upgrade: emit metric events + stamp correlation id ────────────
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
  -- 4a. Browser-dispatch rows whose lease expired before an ack.
  WITH reaped AS (
    UPDATE community_ai_actions
    SET    status                    = 'failed',
           execution_result           = jsonb_build_object(
             'source',       'lease_reaper',
             'error_code',   'DISPATCH_LEASE_EXPIRED',
             'error_message','No extension ack before dispatch_lease_expires_at.'
           ),
           execution_correlation_id  = COALESCE(execution_correlation_id, gen_random_uuid()),
           dispatch_lease_id          = NULL,
           dispatch_lease_expires_at  = NULL,
           dispatch_lease_holder_id   = NULL,
           dispatch_acknowledged_at   = NULL,
           updated_at                 = NOW()
    WHERE  status                    = 'pending'
      AND  execution_mode            = 'browser'
      AND  dispatch_lease_expires_at IS NOT NULL
      AND  dispatch_lease_expires_at < NOW()
    RETURNING id, organization_id, platform, action_type, execution_correlation_id, execution_mode
  )
  INSERT INTO community_ai_execution_metric_events (
    organization_id, action_id, correlation_id, event_type, platform, action_type, execution_mode, metadata
  )
  SELECT organization_id, id, execution_correlation_id, 'lease_expired', platform, action_type, execution_mode,
         jsonb_build_object('phase', 'pending')
  FROM   reaped
  RETURNING 1;
  GET DIAGNOSTICS v_reaped_pending = ROW_COUNT;

  -- 4b. `dispatched` / `acknowledged` rows whose lease expired in-flight.
  WITH reaped AS (
    UPDATE community_ai_actions
    SET    status                    = 'failed',
           execution_result           = jsonb_build_object(
             'source',       'lease_reaper',
             'error_code',   'DISPATCH_LEASE_EXPIRED_IN_FLIGHT',
             'error_message','Lease expired while command was in-flight on extension.'
           ),
           execution_correlation_id  = COALESCE(execution_correlation_id, gen_random_uuid()),
           dispatch_lease_id          = NULL,
           dispatch_lease_expires_at  = NULL,
           dispatch_lease_holder_id   = NULL,
           dispatch_acknowledged_at   = NULL,
           updated_at                 = NOW()
    WHERE  status IN ('dispatched', 'acknowledged')
      AND  dispatch_lease_expires_at IS NOT NULL
      AND  dispatch_lease_expires_at < NOW()
    RETURNING id, organization_id, platform, action_type, execution_correlation_id, execution_mode, status AS prior_status
  )
  INSERT INTO community_ai_execution_metric_events (
    organization_id, action_id, correlation_id, event_type, platform, action_type, execution_mode, metadata
  )
  SELECT organization_id, id, execution_correlation_id, 'lease_expired', platform, action_type, execution_mode,
         jsonb_build_object('phase', 'in_flight', 'prior_status', prior_status)
  FROM   reaped
  RETURNING 1;
  GET DIAGNOSTICS v_reaped_dispatched = ROW_COUNT;

  -- 4c. `executing` rows older than 2 minutes.
  WITH reaped AS (
    UPDATE community_ai_actions
    SET    status                   = 'failed',
           execution_result         = jsonb_build_object(
             'source',       'lease_reaper',
             'error_code',   'EXECUTING_TIMEOUT',
             'error_message','Row stuck in executing > 2 minutes.'
           ),
           execution_correlation_id = COALESCE(execution_correlation_id, gen_random_uuid()),
           updated_at               = NOW()
    WHERE  status = 'executing'
      AND  updated_at < NOW() - INTERVAL '2 minutes'
    RETURNING id, organization_id, platform, action_type, execution_correlation_id, execution_mode
  )
  INSERT INTO community_ai_execution_metric_events (
    organization_id, action_id, correlation_id, event_type, platform, action_type, execution_mode, metadata
  )
  SELECT organization_id, id, execution_correlation_id, 'lease_expired', platform, action_type, execution_mode,
         jsonb_build_object('phase', 'executing_timeout')
  FROM   reaped
  RETURNING 1;
  GET DIAGNOSTICS v_reaped_executing = ROW_COUNT;

  -- 4d. Defensive cleanup: terminal rows that still carry lease metadata.
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

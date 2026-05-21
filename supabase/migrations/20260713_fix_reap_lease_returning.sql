-- ─────────────────────────────────────────────────────────────────────────────
-- Fix: reap_community_ai_action_leases() — 42601 "query has no destination
-- for result data".
--
-- Every prior definition (20260522/523/524/525) ends each metric-event INSERT
-- with `RETURNING 1`, which inside PL/pgSQL is a result-producing statement
-- with no INTO / no destination → PostgreSQL raises 42601 at execution time,
-- so the lease reaper has never run successfully.
--
-- The `RETURNING 1` was vestigial: each INSERT is immediately followed by
-- `GET DIAGNOSTICS v_* = ROW_COUNT`, which already reports the inserted row
-- count without RETURNING. This migration drops the three dangling
-- `RETURNING 1` clauses; behavior and counters are otherwise unchanged.
--
-- Additive / idempotent: a single CREATE OR REPLACE FUNCTION. No table, no
-- data, no RLS, no ledger changes. Depends only on community_ai_actions and
-- community_ai_execution_metric_events (both already present in production).
-- ─────────────────────────────────────────────────────────────────────────────

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
  -- Browser-dispatch rows whose lease expired before an ack.
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
  FROM   reaped;
  GET DIAGNOSTICS v_reaped_pending = ROW_COUNT;

  -- dispatched / acknowledged rows whose lease expired in-flight.
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
  FROM   reaped;
  GET DIAGNOSTICS v_reaped_dispatched = ROW_COUNT;

  -- executing rows older than the per-mode timeout.
  WITH reaped AS (
    UPDATE community_ai_actions
    SET    status                   = 'failed',
           execution_result         = jsonb_build_object(
             'source',       'lease_reaper',
             'error_code',   'EXECUTING_TIMEOUT',
             'error_message','Row stuck in executing past per-mode timeout.',
             'execution_mode', COALESCE(execution_mode, 'unknown')
           ),
           execution_correlation_id = COALESCE(execution_correlation_id, gen_random_uuid()),
           updated_at               = NOW()
    WHERE  status = 'executing'
      AND  (
            (execution_mode = 'api'     AND updated_at < NOW() - INTERVAL '30 seconds')
         OR (execution_mode = 'browser' AND updated_at < NOW() - INTERVAL '90 seconds')
         OR (execution_mode = 'rpa'     AND updated_at < NOW() - INTERVAL '5 minutes')
         OR (execution_mode NOT IN ('api','browser','rpa') AND updated_at < NOW() - INTERVAL '2 minutes')
         OR (execution_mode IS NULL AND updated_at < NOW() - INTERVAL '2 minutes')
      )
    RETURNING id, organization_id, platform, action_type, execution_correlation_id, execution_mode
  )
  INSERT INTO community_ai_execution_metric_events (
    organization_id, action_id, correlation_id, event_type, platform, action_type, execution_mode, metadata
  )
  SELECT organization_id, id, execution_correlation_id, 'lease_expired', platform, action_type, execution_mode,
         jsonb_build_object('phase', 'executing_timeout')
  FROM   reaped;
  GET DIAGNOSTICS v_reaped_executing = ROW_COUNT;

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

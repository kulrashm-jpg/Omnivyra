-- ROLLBACK for 20261231000005_extension_dispatch_safety.sql
--
-- ROLLBACK ORDER for the 20261231 chain (verified on real PostgreSQL 2026-10-28):
--   0009 -> 0008 -> 0007 -> 0006 -> 0003 -> 0004 -> 0005 -> 0002 -> 0001 -> 0000
-- Run AFTER migration_rerun_safety_rollback.sql (20261231000009) and BEFORE
-- community_execution_safety_rollback.sql (20261231000002). Note: by default
-- the uncertain-outcome reaper is KEPT, and 20261231000002's rollback then
-- refuses (the prior CHECK rejects 'uncertain'): keep 20261231000002 unless the
-- failed-marking reaper is restored below by explicit acknowledgement.
--
-- Refuses (raises, changing nothing) when rolling back would lose data or
-- re-enable an unsafe state:
--   - any rpa_auth_token_redemptions row belongs to a token that has not yet
--     expired: dropping the ledger would make that token replayable;
--   - restoring the 'failed'-marking lease reaper re-enables the duplicate-
--     send path (a may-have-acted row reads as "not acted" and can be
--     revived). The reaper is therefore KEPT by default. It is restored only
--     when the operator explicitly sets, in the same transaction:
--        SET LOCAL omnivyra.extension_dispatch_safety_restore_failed_reaper = 'i-accept-duplicate-send-risk';
--
-- 'uncertain' rows the reaper produced are never rewritten: they may have
-- acted, and their late_results evidence lives in execution_result.
--
-- Dropping claim_community_ai_browser_command fails CLOSED: application code
-- that calls it stops claiming browser commands. Deploy the prior application
-- code before running this rollback.
--
-- Run inside a transaction; every refusal aborts it.

DO $$
DECLARE
  v_live bigint;
BEGIN
  IF to_regclass('public.rpa_auth_token_redemptions') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.rpa_auth_token_redemptions WHERE token_expires_at > NOW()' INTO v_live;
    IF v_live > 0 THEN
      RAISE EXCEPTION 'extension dispatch safety rollback: % redeemed RPA auth tokens are still unexpired; dropping the ledger would make them replayable. Retry after they expire', v_live;
    END IF;
  END IF;
END
$$;

DROP FUNCTION IF EXISTS public.record_community_ai_late_dispatch_result(uuid, uuid, text, text, jsonb);
DROP FUNCTION IF EXISTS public.claim_community_ai_browser_command(uuid, uuid, text, text, integer);
DROP TABLE IF EXISTS public.rpa_auth_token_redemptions;

-- Optional, explicitly acknowledged: restore the 20260713 reaper body.
DO $$
BEGIN
  IF coalesce(current_setting('omnivyra.extension_dispatch_safety_restore_failed_reaper', true), '')
       <> 'i-accept-duplicate-send-risk' THEN
    RAISE NOTICE 'extension dispatch safety rollback: keeping the uncertain-outcome lease reaper (restoring the failed-marking reaper re-enables duplicate sends)';
    RETURN;
  END IF;

  EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.reap_community_ai_action_leases()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $body$
DECLARE
  v_reaped_pending      integer := 0;
  v_reaped_dispatched   integer := 0;
  v_reaped_executing    integer := 0;
  v_lease_cleared       integer := 0;
BEGIN
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
$body$
$fn$;
  EXECUTE 'COMMENT ON FUNCTION public.reap_community_ai_action_leases() IS NULL';
  RAISE NOTICE 'extension dispatch safety rollback: failed-marking reaper restored by explicit acknowledgement';
END
$$;

-- Postcondition: the new objects are gone; the reaper still exists.
DO $$
BEGIN
  IF to_regprocedure('public.claim_community_ai_browser_command(uuid,uuid,text,text,integer)') IS NOT NULL
     OR to_regprocedure('public.record_community_ai_late_dispatch_result(uuid,uuid,text,text,jsonb)') IS NOT NULL
     OR to_regclass('public.rpa_auth_token_redemptions') IS NOT NULL THEN
    RAISE EXCEPTION 'extension dispatch safety rollback postcondition: migration objects remain';
  END IF;
  IF to_regprocedure('public.reap_community_ai_action_leases()') IS NULL THEN
    RAISE EXCEPTION 'extension dispatch safety rollback postcondition: reaper is absent';
  END IF;
END
$$;

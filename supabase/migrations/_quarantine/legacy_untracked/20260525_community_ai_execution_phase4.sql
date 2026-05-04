-- =============================================================================
-- Community AI Execution Engine — phase 4 hardening
--
-- 1. Remove session-level trigger bypass (security). Replace with a
--    SECURITY DEFINER admin override function callable ONLY by service_role.
-- 2. Widen trigger to accept rollup / DLQ flusher / admin override as
--    legitimate system sources.
-- 3. Per-mode reaper timeouts for stuck `executing` rows.
-- 4. `community_ai_metric_dlq` — durable queue for metric inserts that
--    failed against the main events table. Includes retry metadata.
-- 5. `community_ai_execution_metrics_daily` — pre-aggregated counters per
--    (org, platform, action_type, date). Populated by
--    `refresh_community_ai_execution_metrics_daily()`.
-- =============================================================================

BEGIN;

-- ── 1. Trigger: drop session-level bypass, widen system-source allow list ───
CREATE OR REPLACE FUNCTION enforce_community_ai_executor_writes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_source text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- Terminal success transitions require executor provenance.
  IF NEW.status IN ('executed', 'sent_unverified') THEN
    v_source := COALESCE(NEW.execution_result->>'source', '');
    IF NEW.execution_correlation_id IS NULL AND v_source NOT IN ('executor', 'admin_override') THEN
      RAISE EXCEPTION 'executor_only_write: transition to % requires execution_correlation_id (actionId=%)',
        NEW.status, NEW.id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Terminal failure transitions require either a correlation id or an
  -- explicit system source (reaper / DLQ flusher / admin override).
  IF NEW.status = 'failed' THEN
    v_source := COALESCE(NEW.execution_result->>'source', '');
    IF NEW.execution_correlation_id IS NULL
       AND v_source NOT IN ('lease_reaper', 'executor', 'admin_override')
    THEN
      RAISE EXCEPTION 'executor_only_write: transition to failed requires execution_correlation_id OR execution_result.source in (lease_reaper, executor, admin_override) (actionId=%)',
        NEW.id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ── 2. Admin override (SECURITY DEFINER; service-role only) ────────────────
--
-- Replaces the session-level GUC bypass. Callable ONLY by service_role and
-- stamps `execution_result.source = 'admin_override'` so the trigger allows
-- the write. Every call is audited to `audit_logs`.
CREATE OR REPLACE FUNCTION admin_override_community_ai_status(
  p_action_id uuid,
  p_new_status text,
  p_note text DEFAULT NULL,
  p_actor_user_id uuid DEFAULT NULL
) RETURNS community_ai_actions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role text := current_setting('role', true);
  v_row community_ai_actions;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND COALESCE(v_caller_role, '') NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'admin_override_forbidden: caller role %, expected service_role', v_caller_role
      USING ERRCODE = '42501';
  END IF;

  IF p_new_status NOT IN (
    'pending','approved','dispatched','acknowledged','executing',
    'executed','sent_unverified','failed','skipped','blocked','scheduled'
  ) THEN
    RAISE EXCEPTION 'invalid status: %', p_new_status USING ERRCODE = '22023';
  END IF;

  UPDATE community_ai_actions
  SET    status                     = p_new_status,
         execution_result           = COALESCE(execution_result, '{}'::jsonb)
                                      || jsonb_build_object(
                                           'source',            'admin_override',
                                           'override_note',     p_note,
                                           'override_at',       NOW(),
                                           'override_actor',    p_actor_user_id
                                         ),
         dispatch_lease_id          = NULL,
         dispatch_lease_expires_at  = NULL,
         dispatch_lease_holder_id   = NULL,
         dispatch_acknowledged_at   = NULL,
         updated_at                 = NOW()
  WHERE  id = p_action_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_override_not_found: action_id %', p_action_id
      USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO audit_logs (actor_user_id, action, metadata, created_at)
  VALUES (
    p_actor_user_id,
    'COMMUNITY_AI_ADMIN_OVERRIDE',
    jsonb_build_object(
      'action_id',   p_action_id,
      'new_status',  p_new_status,
      'note',        p_note
    ),
    NOW()
  );

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION admin_override_community_ai_status FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_override_community_ai_status TO service_role;

-- ── 3. Per-mode reaper timeouts for stuck `executing` rows ──────────────────
-- api → 30s, rpa → 5 min, browser → 90s (though browser-mode rows should not
-- reach `executing`; it's there for defensive coverage).
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
  FROM   reaped
  RETURNING 1;
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
  FROM   reaped
  RETURNING 1;
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
  FROM   reaped
  RETURNING 1;
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

-- ── 4. community_ai_metric_dlq — durable metric retry queue ─────────────────
CREATE TABLE IF NOT EXISTS community_ai_metric_dlq (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL,
  action_id             uuid,
  correlation_id        uuid,
  event_type            text NOT NULL,
  platform              text,
  action_type           text,
  execution_mode        text,
  metadata              jsonb,
  retry_count           integer NOT NULL DEFAULT 0,
  last_error            text,
  next_retry_at         timestamptz NOT NULL DEFAULT NOW(),
  created_at            timestamptz NOT NULL DEFAULT NOW(),
  updated_at            timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_camdlq_next_retry
  ON community_ai_metric_dlq (next_retry_at)
  WHERE retry_count < 10;

ALTER TABLE community_ai_metric_dlq ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'community_ai_metric_dlq'
      AND policyname = 'service_role_all'
  ) THEN
    CREATE POLICY "service_role_all" ON community_ai_metric_dlq
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- Flush DLQ in batches. Each successful re-insert deletes the DLQ row;
-- failures increment retry_count and push next_retry_at forward with
-- exponential backoff (capped at 10 retries). Returns counters.
CREATE OR REPLACE FUNCTION flush_community_ai_metric_dlq(p_limit integer DEFAULT 500)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_claimed integer := 0;
  v_flushed integer := 0;
  v_remaining integer := 0;
  r RECORD;
BEGIN
  FOR r IN
    SELECT id, organization_id, action_id, correlation_id, event_type, platform,
           action_type, execution_mode, metadata, retry_count
    FROM   community_ai_metric_dlq
    WHERE  next_retry_at <= NOW()
      AND  retry_count < 10
    ORDER BY next_retry_at ASC
    LIMIT  p_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    v_claimed := v_claimed + 1;
    BEGIN
      INSERT INTO community_ai_execution_metric_events (
        organization_id, action_id, correlation_id, event_type, platform,
        action_type, execution_mode, metadata
      ) VALUES (
        r.organization_id, r.action_id, r.correlation_id, r.event_type, r.platform,
        r.action_type, r.execution_mode, r.metadata
      );
      DELETE FROM community_ai_metric_dlq WHERE id = r.id;
      v_flushed := v_flushed + 1;
    EXCEPTION WHEN OTHERS THEN
      -- Exponential backoff: 2^retry_count seconds, capped at 1 hour.
      UPDATE community_ai_metric_dlq
      SET    retry_count   = retry_count + 1,
             last_error    = substring(SQLERRM, 1, 500),
             next_retry_at = NOW() + LEAST(INTERVAL '1 hour',
                                           (2 ^ LEAST(retry_count + 1, 12)) * INTERVAL '1 second'),
             updated_at    = NOW()
      WHERE  id = r.id;
    END;
  END LOOP;

  SELECT COUNT(*) INTO v_remaining FROM community_ai_metric_dlq WHERE retry_count < 10;

  RETURN jsonb_build_object(
    'claimed',   v_claimed,
    'flushed',   v_flushed,
    'remaining', v_remaining,
    'flushed_at', NOW()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION flush_community_ai_metric_dlq TO service_role;

-- ── 5. community_ai_execution_metrics_daily — rollup table ──────────────────
CREATE TABLE IF NOT EXISTS community_ai_execution_metrics_daily (
  organization_id        uuid NOT NULL,
  platform               text NOT NULL DEFAULT '',
  action_type            text NOT NULL DEFAULT '',
  bucket_date            date NOT NULL,
  started_count          bigint NOT NULL DEFAULT 0,
  success_count          bigint NOT NULL DEFAULT 0,
  failure_count          bigint NOT NULL DEFAULT 0,
  fallback_count         bigint NOT NULL DEFAULT 0,
  lease_expired_count    bigint NOT NULL DEFAULT 0,
  ack_count              bigint NOT NULL DEFAULT 0,
  refreshed_at           timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, platform, action_type, bucket_date)
);

ALTER TABLE community_ai_execution_metrics_daily ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'community_ai_execution_metrics_daily'
      AND policyname = 'service_role_all'
  ) THEN
    CREATE POLICY "service_role_all" ON community_ai_execution_metrics_daily
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- Rebuild the rollup for a given window. Idempotent: UPSERT replaces the
-- rolled-up counters for each (org, platform, action_type, date) cell so
-- late-arriving events are picked up on the next refresh.
CREATE OR REPLACE FUNCTION refresh_community_ai_execution_metrics_daily(
  p_window_days integer DEFAULT 7
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rows_upserted integer := 0;
BEGIN
  WITH agg AS (
    SELECT
      organization_id,
      COALESCE(platform,    '') AS platform,
      COALESCE(action_type, '') AS action_type,
      (created_at AT TIME ZONE 'UTC')::date AS bucket_date,
      COUNT(*) FILTER (WHERE event_type = 'execution_started')   AS started_count,
      COUNT(*) FILTER (WHERE event_type = 'execution_success')   AS success_count,
      COUNT(*) FILTER (WHERE event_type = 'execution_failed')    AS failure_count,
      COUNT(*) FILTER (WHERE event_type = 'fallback_triggered')  AS fallback_count,
      COUNT(*) FILTER (WHERE event_type = 'lease_expired')       AS lease_expired_count,
      COUNT(*) FILTER (WHERE event_type = 'ack_received')        AS ack_count
    FROM   community_ai_execution_metric_events
    WHERE  created_at >= NOW() - (p_window_days || ' days')::INTERVAL
    GROUP  BY organization_id, platform, action_type, bucket_date
  )
  INSERT INTO community_ai_execution_metrics_daily AS t (
    organization_id, platform, action_type, bucket_date,
    started_count, success_count, failure_count, fallback_count,
    lease_expired_count, ack_count, refreshed_at
  )
  SELECT organization_id, platform, action_type, bucket_date,
         started_count, success_count, failure_count, fallback_count,
         lease_expired_count, ack_count, NOW()
  FROM   agg
  ON CONFLICT (organization_id, platform, action_type, bucket_date)
  DO UPDATE SET
    started_count       = EXCLUDED.started_count,
    success_count       = EXCLUDED.success_count,
    failure_count       = EXCLUDED.failure_count,
    fallback_count      = EXCLUDED.fallback_count,
    lease_expired_count = EXCLUDED.lease_expired_count,
    ack_count           = EXCLUDED.ack_count,
    refreshed_at        = NOW();

  GET DIAGNOSTICS v_rows_upserted = ROW_COUNT;

  RETURN jsonb_build_object(
    'rows_upserted', v_rows_upserted,
    'window_days',   p_window_days,
    'refreshed_at',  NOW()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION refresh_community_ai_execution_metrics_daily TO service_role;

COMMIT;

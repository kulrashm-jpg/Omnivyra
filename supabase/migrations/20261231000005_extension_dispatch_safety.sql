-- Extension dispatch safety — lease reaper, atomic claim, late-result
-- reconciliation, single-use RPA auth tokens.
--
-- Owned by the browser-extension dispatch slice. Four changes:
--
-- 1. reap_community_ai_action_leases() (CREATE OR REPLACE; replaces the body
--    from 20260713_fix_reap_lease_returning.sql, which is NOT edited).
--    A claimed browser command whose lease lapsed, a dispatched/acknowledged
--    command whose lease lapsed, and an 'executing' row past its per-mode
--    timeout MAY have reached the platform. They were marked 'failed', which
--    every reader treats as "not acted" and which a deterministic action id
--    could later revive to 'pending' (a second DM). They now become
--    'uncertain' — terminal, human review, never executed automatically — with
--    the SAME error codes (DISPATCH_LEASE_EXPIRED,
--    DISPATCH_LEASE_EXPIRED_IN_FLIGHT, EXECUTING_TIMEOUT) and
--    may_have_acted = true. The lease id / holder are KEPT on the row so a late
--    result from the true claimant can still be authenticated and recorded.
--    The lease-clearing sweep never touches 'uncertain' rows.
--
-- 2. claim_community_ai_browser_command(...) — the ONLY claim of a browser
--    command. One conditional UPDATE ... RETURNING enforces, atomically:
--    tenant, status='pending', execution_mode='browser', never claimed
--    (dispatch_lease_id IS NULL: a lapsed lease is never re-offered to anyone),
--    not cancelled (cancel_requested_at IS NULL), platform kill switch
--    (community_ai_platform_policy.execution_enabled), and approval (the same
--    rule the executor applies: approved_at, or no approval required by the
--    row, its risk level, or the platform policy).
--
-- 3. record_community_ai_late_dispatch_result(...) — appends a late extension
--    report to execution_result.late_results of an 'uncertain' row, only for
--    the lease holder that claimed it. The status is NOT changed: the report is
--    evidence for the reviewer, not an automatic resolution.
--
-- 4. rpa_auth_token_redemptions — durable single-use ledger for RPA auth
--    session tokens (primary key = token nonce). Service role only.
--
-- Idempotent: every statement is CREATE OR REPLACE / IF NOT EXISTS / guarded.
-- Guarded by pre- and postconditions. NOT applied anywhere yet.
-- Requires 20261231000002_community_execution_safety.sql ('uncertain' status).
-- ROLLBACK: supabase/migrations/rollbacks/extension_dispatch_safety_rollback.sql

-- ── Preconditions ────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_def text;
BEGIN
  IF to_regclass('public.community_ai_actions') IS NULL THEN
    RAISE EXCEPTION 'extension dispatch safety: public.community_ai_actions is absent';
  END IF;
  IF to_regclass('public.community_ai_execution_metric_events') IS NULL THEN
    RAISE EXCEPTION 'extension dispatch safety: public.community_ai_execution_metric_events is absent';
  END IF;
  IF to_regclass('public.community_ai_platform_policy') IS NULL THEN
    RAISE EXCEPTION 'extension dispatch safety: public.community_ai_platform_policy is absent';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'community_ai_actions'
         AND column_name IN ('id', 'organization_id', 'status', 'execution_mode', 'execution_result',
                             'execution_correlation_id', 'dispatch_lease_id', 'dispatch_lease_expires_at',
                             'dispatch_lease_holder_id', 'dispatch_acknowledged_at', 'cancel_requested_at',
                             'approved_at', 'requires_human_approval', 'risk_level', 'updated_at')) <> 15 THEN
    RAISE EXCEPTION 'extension dispatch safety: community_ai_actions lacks a required column';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'community_ai_platform_policy'
         AND column_name IN ('execution_enabled', 'require_human_approval', 'updated_at')) <> 3 THEN
    RAISE EXCEPTION 'extension dispatch safety: community_ai_platform_policy lacks a required column';
  END IF;
  SELECT pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_constraint c
   WHERE c.conrelid = 'public.community_ai_actions'::regclass
     AND c.conname  = 'community_ai_actions_status_check';
  IF v_def IS NULL OR v_def NOT LIKE '%''uncertain''%' THEN
    RAISE EXCEPTION 'extension dispatch safety: status CHECK does not allow ''uncertain'' (apply 20261231000002 first): %', v_def;
  END IF;
  -- Re-run safety: an existing ledger table must have the expected key.
  IF to_regclass('public.rpa_auth_token_redemptions') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'rpa_auth_token_redemptions'
       AND column_name = 'nonce' AND data_type = 'text'
  ) THEN
    RAISE EXCEPTION 'extension dispatch safety: rpa_auth_token_redemptions exists with an unexpected shape';
  END IF;
END
$$;

-- ── 1. Lease reaper: possibly-delivered rows become 'uncertain' ─────────────
CREATE OR REPLACE FUNCTION public.reap_community_ai_action_leases()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reaped_pending      integer := 0;
  v_reaped_dispatched   integer := 0;
  v_reaped_executing    integer := 0;
  v_lease_cleared       integer := 0;
BEGIN
  -- Claimed browser commands whose lease lapsed before a result arrived. The
  -- claim was handed to an extension, so the platform action may have run.
  -- Lease id / holder are KEPT so the claimant's late result can be recorded.
  WITH reaped AS (
    UPDATE community_ai_actions
    SET    status                    = 'uncertain',
           execution_result          = jsonb_build_object(
             'source',                 'lease_reaper',
             'status',                 'uncertain',
             'error_code',             'DISPATCH_LEASE_EXPIRED',
             'error_message',          'Lease expired before a result was recorded; the extension may have performed the action. Review required; never retried automatically.',
             'may_have_acted',         true,
             'prior_status',           status,
             'reaped_at',              NOW(),
             'prior_execution_result', execution_result
           ),
           execution_correlation_id  = COALESCE(execution_correlation_id, gen_random_uuid()),
           updated_at                = NOW()
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
         jsonb_build_object('phase', 'pending', 'outcome', 'uncertain')
  FROM   reaped;
  GET DIAGNOSTICS v_reaped_pending = ROW_COUNT;

  -- dispatched / acknowledged rows whose lease expired in-flight.
  WITH reaped AS (
    UPDATE community_ai_actions
    SET    status                    = 'uncertain',
           execution_result          = jsonb_build_object(
             'source',                 'lease_reaper',
             'status',                 'uncertain',
             'error_code',             'DISPATCH_LEASE_EXPIRED_IN_FLIGHT',
             'error_message',          'Lease expired while the command was in flight on the extension. Review required; never retried automatically.',
             'may_have_acted',         true,
             'prior_status',           status,
             'reaped_at',              NOW(),
             'prior_execution_result', execution_result
           ),
           execution_correlation_id  = COALESCE(execution_correlation_id, gen_random_uuid()),
           updated_at                = NOW()
    WHERE  status IN ('dispatched', 'acknowledged')
      AND  dispatch_lease_expires_at IS NOT NULL
      AND  dispatch_lease_expires_at < NOW()
    RETURNING id, organization_id, platform, action_type, execution_correlation_id, execution_mode, execution_result->>'prior_status' AS prior_status
  )
  INSERT INTO community_ai_execution_metric_events (
    organization_id, action_id, correlation_id, event_type, platform, action_type, execution_mode, metadata
  )
  SELECT organization_id, id, execution_correlation_id, 'lease_expired', platform, action_type, execution_mode,
         jsonb_build_object('phase', 'in_flight', 'prior_status', prior_status, 'outcome', 'uncertain')
  FROM   reaped;
  GET DIAGNOSTICS v_reaped_dispatched = ROW_COUNT;

  -- executing rows older than the per-mode timeout: a worker held the claim
  -- and may have performed the action before dying.
  WITH reaped AS (
    UPDATE community_ai_actions
    SET    status                   = 'uncertain',
           execution_result         = jsonb_build_object(
             'source',                 'lease_reaper',
             'status',                 'uncertain',
             'error_code',             'EXECUTING_TIMEOUT',
             'error_message',          'Row stuck in executing past per-mode timeout; the action may have been performed. Review required; never retried automatically.',
             'execution_mode',         COALESCE(execution_mode, 'unknown'),
             'may_have_acted',         true,
             'prior_status',           status,
             'reaped_at',              NOW(),
             'prior_execution_result', execution_result
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
         jsonb_build_object('phase', 'executing_timeout', 'outcome', 'uncertain')
  FROM   reaped;
  GET DIAGNOSTICS v_reaped_executing = ROW_COUNT;

  -- Terminal rows still carrying lease metadata. 'uncertain' is deliberately
  -- NOT in this list: its lease id / holder authenticate a late result.
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
    'reaped_status',     'uncertain',
    'reaped_at',         NOW()
  );
END;
$$;

COMMENT ON FUNCTION public.reap_community_ai_action_leases() IS
  'extension_dispatch_safety: lapsed claims and executing timeouts become uncertain (may have acted; review; never retried). Lease id/holder kept for late-result reconciliation.';

-- ── 2. Atomic browser-command claim ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_community_ai_browser_command(
  p_action_id         uuid,
  p_organization_id   uuid,
  p_lease_id          text,
  p_holder_id         text,
  p_lease_ttl_seconds integer
)
RETURNS TABLE (id uuid, dispatch_lease_expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_execution_enabled      boolean;
  v_require_human_approval boolean;
BEGIN
  IF p_action_id IS NULL OR p_organization_id IS NULL
     OR coalesce(btrim(p_lease_id), '') = '' OR coalesce(btrim(p_holder_id), '') = '' THEN
    RAISE EXCEPTION 'claim_community_ai_browser_command: action, organization, lease and holder are required';
  END IF;
  IF p_lease_ttl_seconds IS NULL OR p_lease_ttl_seconds < 1 OR p_lease_ttl_seconds > 600 THEN
    RAISE EXCEPTION 'claim_community_ai_browser_command: lease ttl must be between 1 and 600 seconds';
  END IF;

  -- Platform policy: the most recent row wins; no row means the application
  -- defaults (execution enabled, no global approval requirement), exactly as
  -- communityAiPlatformPolicyService resolves it.
  SELECT p.execution_enabled, p.require_human_approval
    INTO v_execution_enabled, v_require_human_approval
    FROM community_ai_platform_policy p
   ORDER BY p.updated_at DESC
   LIMIT 1;
  v_execution_enabled      := coalesce(v_execution_enabled, true);
  v_require_human_approval := coalesce(v_require_human_approval, false);

  IF NOT v_execution_enabled THEN
    RETURN;  -- kill switch: nothing is claimed
  END IF;

  RETURN QUERY
  UPDATE community_ai_actions a
     SET dispatch_lease_id         = p_lease_id,
         dispatch_lease_expires_at = NOW() + make_interval(secs => p_lease_ttl_seconds),
         dispatch_lease_holder_id  = p_holder_id,
         updated_at                = NOW()
   WHERE a.id                  = p_action_id
     AND a.organization_id     = p_organization_id
     AND a.status              = 'pending'
     AND a.execution_mode      = 'browser'
     AND a.dispatch_lease_id   IS NULL
     AND a.cancel_requested_at IS NULL
     AND (
           a.approved_at IS NOT NULL
        OR (    a.requires_human_approval IS NOT TRUE
            AND coalesce(a.risk_level, '') <> 'high'
            AND NOT v_require_human_approval)
     )
  RETURNING a.id, a.dispatch_lease_expires_at;
END;
$$;

COMMENT ON FUNCTION public.claim_community_ai_browser_command(uuid, uuid, text, text, integer) IS
  'extension_dispatch_safety: the only claim of a browser command. Atomic: tenant, pending, browser, never claimed, not cancelled, kill switch, approval.';

-- ── 3. Late-result reconciliation for 'uncertain' rows ──────────────────────
CREATE OR REPLACE FUNCTION public.record_community_ai_late_dispatch_result(
  p_action_id       uuid,
  p_organization_id uuid,
  p_lease_id        text,
  p_holder_id       text,
  p_report          jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_action_id IS NULL OR p_organization_id IS NULL
     OR coalesce(btrim(p_lease_id), '') = '' OR coalesce(btrim(p_holder_id), '') = ''
     OR p_report IS NULL OR jsonb_typeof(p_report) <> 'object' THEN
    RAISE EXCEPTION 'record_community_ai_late_dispatch_result: action, organization, lease, holder and an object report are required';
  END IF;

  UPDATE community_ai_actions a
     SET execution_result = jsonb_set(
           coalesce(a.execution_result, '{}'::jsonb),
           '{late_results}',
           coalesce(a.execution_result -> 'late_results', '[]'::jsonb)
             || jsonb_build_array(p_report || jsonb_build_object('received_at', NOW())),
           true),
         updated_at = NOW()
   WHERE a.id                       = p_action_id
     AND a.organization_id          = p_organization_id
     AND a.status                   = 'uncertain'
     AND a.dispatch_lease_id        = p_lease_id
     AND a.dispatch_lease_holder_id = p_holder_id
     AND jsonb_array_length(coalesce(a.execution_result -> 'late_results', '[]'::jsonb)) < 20
  RETURNING a.id INTO v_id;

  RETURN CASE WHEN v_id IS NULL THEN 'not_matched' ELSE 'recorded' END;
END;
$$;

COMMENT ON FUNCTION public.record_community_ai_late_dispatch_result(uuid, uuid, text, text, jsonb) IS
  'extension_dispatch_safety: records a late extension result on an uncertain row for its lease holder; never changes status.';

-- ── 4. Single-use RPA auth token ledger ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rpa_auth_token_redemptions (
  nonce            text        PRIMARY KEY,
  organization_id  uuid        NOT NULL,
  platform         text        NOT NULL,
  user_id          text        NOT NULL,
  token_expires_at timestamptz NOT NULL,
  redeemed_at      timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rpa_auth_token_redemptions_expires
  ON public.rpa_auth_token_redemptions (token_expires_at);

ALTER TABLE public.rpa_auth_token_redemptions ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.rpa_auth_token_redemptions IS
  'extension_dispatch_safety: one row per redeemed RPA auth session token (nonce). A second redemption hits the primary key and is refused. Service role only.';

-- ── Privileges: service role only ───────────────────────────────────────────
REVOKE ALL ON TABLE public.rpa_auth_token_redemptions FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.rpa_auth_token_redemptions FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.rpa_auth_token_redemptions FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT SELECT, INSERT, DELETE ON TABLE public.rpa_auth_token_redemptions TO service_role';
  END IF;
END
$$;

DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.reap_community_ai_action_leases()',
    'public.claim_community_ai_browser_command(uuid,uuid,text,text,integer)',
    'public.record_community_ai_late_dispatch_result(uuid,uuid,text,text,jsonb)'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', f);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', f);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', f);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
    END IF;
  END LOOP;
END
$$;

-- ── Postconditions ───────────────────────────────────────────────────────────
DO $$
DECLARE
  v_src text;
  f     text;
BEGIN
  SELECT p.prosrc INTO v_src FROM pg_proc p
   WHERE p.oid = to_regprocedure('public.reap_community_ai_action_leases()');
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'extension dispatch safety postcondition: reaper is absent';
  END IF;
  IF v_src ~ 'status\s*=\s*''failed'''
     OR v_src NOT LIKE '%''DISPATCH_LEASE_EXPIRED''%'
     OR v_src NOT LIKE '%''DISPATCH_LEASE_EXPIRED_IN_FLIGHT''%'
     OR v_src NOT LIKE '%''EXECUTING_TIMEOUT''%'
     OR v_src NOT LIKE '%''uncertain''%' THEN
    RAISE EXCEPTION 'extension dispatch safety postcondition: reaper body is not the uncertain-outcome version';
  END IF;

  FOREACH f IN ARRAY ARRAY[
    'public.reap_community_ai_action_leases()',
    'public.claim_community_ai_browser_command(uuid,uuid,text,text,integer)',
    'public.record_community_ai_late_dispatch_result(uuid,uuid,text,text,jsonb)'
  ] LOOP
    IF to_regprocedure(f) IS NULL THEN
      RAISE EXCEPTION 'extension dispatch safety postcondition: % is absent', f;
    END IF;
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure(f)) THEN
      RAISE EXCEPTION 'extension dispatch safety postcondition: % is not SECURITY DEFINER', f;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
       AND has_function_privilege('anon', to_regprocedure(f), 'EXECUTE') THEN
      RAISE EXCEPTION 'extension dispatch safety postcondition: anon can execute %', f;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
       AND has_function_privilege('authenticated', to_regprocedure(f), 'EXECUTE') THEN
      RAISE EXCEPTION 'extension dispatch safety postcondition: authenticated can execute %', f;
    END IF;
  END LOOP;

  IF to_regclass('public.rpa_auth_token_redemptions') IS NULL
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.rpa_auth_token_redemptions'::regclass)
     OR NOT EXISTS (SELECT 1 FROM pg_constraint
                     WHERE conrelid = 'public.rpa_auth_token_redemptions'::regclass AND contype = 'p') THEN
    RAISE EXCEPTION 'extension dispatch safety postcondition: rpa_auth_token_redemptions is incomplete';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND has_table_privilege('anon', 'public.rpa_auth_token_redemptions', 'SELECT') THEN
    RAISE EXCEPTION 'extension dispatch safety postcondition: anon can read rpa_auth_token_redemptions';
  END IF;
END
$$;

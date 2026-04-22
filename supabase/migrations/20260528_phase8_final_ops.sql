-- =============================================================================
-- Phase 8 — final operational hardening
--
-- 1. command_chain / command_chain_index on community_ai_actions
--    Multi-step orchestration (e.g. open_thread → continue_thread). The
--    executor synthesizes the chain; /api/extension/commands dispatches
--    the current step; /api/extension/action-result advances it.
-- 2. rpa_retry_queue — durable retry buffer for RPA tasks that failed
--    transiently. Worker drains it with exponential backoff.
-- 3. rpa_queue_state — singleton row tracking current backpressure state
--    (READY / DEGRADED / BLOCKED) for observability and admin override.
-- =============================================================================

BEGIN;

-- ── 1. command_chain on community_ai_actions ────────────────────────────────
ALTER TABLE community_ai_actions
  ADD COLUMN IF NOT EXISTS command_chain       jsonb,
  ADD COLUMN IF NOT EXISTS command_chain_index integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN community_ai_actions.command_chain IS
  'Ordered list of extension command steps for this action. Each step is '
  '{ action_type, payload? }. Executor synthesizes this for multi-step '
  'flows (DM open_thread → continue_thread); /api/extension/commands '
  'reads command_chain[command_chain_index] as the next step to dispatch.';
COMMENT ON COLUMN community_ai_actions.command_chain_index IS
  'Zero-based index into command_chain. Advances on intermediate-step '
  'success via /api/extension/action-result; terminal steps mark the '
  'row executed/sent_unverified/failed via the central executor pipeline.';

-- ── 2. rpa_retry_queue ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rpa_retry_queue (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id          uuid NOT NULL,
  organization_id    uuid NOT NULL,
  platform           text NOT NULL,
  action_type        text NOT NULL,
  target_url         text NOT NULL,
  text               text,
  attempts           integer NOT NULL DEFAULT 0,
  last_error         text,
  last_attempt_at    timestamptz,
  next_retry_at      timestamptz NOT NULL DEFAULT NOW(),
  max_attempts       integer NOT NULL DEFAULT 5,
  created_at         timestamptz NOT NULL DEFAULT NOW(),
  updated_at         timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rpa_retry_queue_next_retry
  ON rpa_retry_queue (next_retry_at)
  WHERE attempts < max_attempts;

CREATE UNIQUE INDEX IF NOT EXISTS uq_rpa_retry_queue_action
  ON rpa_retry_queue (action_id);

ALTER TABLE rpa_retry_queue ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='rpa_retry_queue' AND policyname='service_role_all'
  ) THEN
    CREATE POLICY "service_role_all" ON rpa_retry_queue
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- ── 3. rpa_queue_state ──────────────────────────────────────────────────────
-- Singleton row (enforced via UNIQUE on `key = 'global'`) tracking the
-- current backpressure state. Updated by the worker; readable by
-- operators + the admission check in rpaWorkerService.
CREATE TABLE IF NOT EXISTS rpa_queue_state (
  key              text PRIMARY KEY,
  status           text NOT NULL CHECK (status IN ('READY', 'DEGRADED', 'BLOCKED')),
  reason           text,
  failure_rate     numeric,
  window_size      integer,
  observed_at      timestamptz NOT NULL DEFAULT NOW(),
  updated_at       timestamptz NOT NULL DEFAULT NOW()
);

INSERT INTO rpa_queue_state (key, status, reason, observed_at)
VALUES ('global', 'READY', 'initial', NOW())
ON CONFLICT (key) DO NOTHING;

ALTER TABLE rpa_queue_state ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='rpa_queue_state' AND policyname='service_role_all'
  ) THEN
    CREATE POLICY "service_role_all" ON rpa_queue_state
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

COMMIT;

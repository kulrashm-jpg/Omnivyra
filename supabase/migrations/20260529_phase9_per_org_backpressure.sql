-- =============================================================================
-- Phase 9 — per-organization RPA backpressure isolation
--
-- Before: one global rpa_queue_state row (key='global'); one noisy tenant
--         could push the queue to BLOCKED globally.
-- After:  one row per organization_id. The observer populates rows per
--         active org; the admission gate and retry flusher operate on the
--         caller's own organization_id only.
--
-- Self-contained and idempotent: works whether or not the Phase 8
-- baseline (rpa_queue_state, rpa_retry_queue) already exists. If a table
-- is missing, we create it directly in its final per-org shape; if it
-- exists in its Phase 8 shape, we reshape it in place.
-- =============================================================================

BEGIN;

-- ── 1. rpa_queue_state: create-or-reshape to per-org ───────────────────────
DO $$
DECLARE
  v_pk_name text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE  table_schema = 'public' AND table_name = 'rpa_queue_state'
  ) THEN
    -- Fresh deployment: create directly in final shape.
    CREATE TABLE public.rpa_queue_state (
      organization_id uuid PRIMARY KEY,
      status          text NOT NULL CHECK (status IN ('READY', 'DEGRADED', 'BLOCKED')),
      reason          text,
      failure_rate    numeric,
      window_size     integer,
      observed_at     timestamptz NOT NULL DEFAULT NOW(),
      updated_at      timestamptz NOT NULL DEFAULT NOW()
    );
    ALTER TABLE public.rpa_queue_state ENABLE ROW LEVEL SECURITY;

  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE  table_schema = 'public'
      AND  table_name   = 'rpa_queue_state'
      AND  column_name  = 'key'
  ) THEN
    -- Phase 8 shape present: reshape to per-org.
    DELETE FROM public.rpa_queue_state WHERE key = 'global';

    SELECT conname INTO v_pk_name
    FROM   pg_constraint
    WHERE  conrelid = 'public.rpa_queue_state'::regclass
      AND  contype  = 'p'
    LIMIT  1;
    IF v_pk_name IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.rpa_queue_state DROP CONSTRAINT %I', v_pk_name);
    END IF;

    ALTER TABLE public.rpa_queue_state
      ADD COLUMN IF NOT EXISTS organization_id uuid;

    UPDATE public.rpa_queue_state
    SET    organization_id = gen_random_uuid()
    WHERE  organization_id IS NULL;

    ALTER TABLE public.rpa_queue_state
      ALTER COLUMN organization_id SET NOT NULL;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname  = 'rpa_queue_state_pkey'
        AND conrelid = 'public.rpa_queue_state'::regclass
    ) THEN
      ALTER TABLE public.rpa_queue_state
        ADD CONSTRAINT rpa_queue_state_pkey PRIMARY KEY (organization_id);
    END IF;

    ALTER TABLE public.rpa_queue_state DROP COLUMN IF EXISTS key;

  ELSE
    -- Already in Phase 9 shape (or a custom shape missing the `key`
    -- column). Ensure organization_id exists and is the PK.
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE  table_schema = 'public'
        AND  table_name   = 'rpa_queue_state'
        AND  column_name  = 'organization_id'
    ) THEN
      ALTER TABLE public.rpa_queue_state ADD COLUMN organization_id uuid;
      UPDATE public.rpa_queue_state
      SET    organization_id = gen_random_uuid()
      WHERE  organization_id IS NULL;
      ALTER TABLE public.rpa_queue_state
        ALTER COLUMN organization_id SET NOT NULL;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname  = 'rpa_queue_state_pkey'
        AND conrelid = 'public.rpa_queue_state'::regclass
    ) THEN
      ALTER TABLE public.rpa_queue_state
        ADD CONSTRAINT rpa_queue_state_pkey PRIMARY KEY (organization_id);
    END IF;
  END IF;
END $$;

-- RLS policy: service-role only. Safe to re-apply.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'rpa_queue_state'
      AND policyname = 'service_role_all'
  ) THEN
    CREATE POLICY "service_role_all" ON public.rpa_queue_state
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

COMMENT ON COLUMN public.rpa_queue_state.organization_id IS
  'Per-tenant backpressure state. One row per active org; observer '
  'recomputes on its interval, admission gate reads per-caller.';

-- ── 2. rpa_retry_queue: create-if-missing + per-org uniqueness ─────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE  table_schema = 'public' AND table_name = 'rpa_retry_queue'
  ) THEN
    CREATE TABLE public.rpa_retry_queue (
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
    ALTER TABLE public.rpa_retry_queue ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'rpa_retry_queue'
      AND policyname = 'service_role_all'
  ) THEN
    CREATE POLICY "service_role_all" ON public.rpa_retry_queue
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- Widen uniqueness from (action_id) → (organization_id, action_id) and
-- add the round-robin + single-column retry-time indexes.
DROP INDEX IF EXISTS uq_rpa_retry_queue_action;
CREATE UNIQUE INDEX IF NOT EXISTS uq_rpa_retry_queue_org_action
  ON public.rpa_retry_queue (organization_id, action_id);

CREATE INDEX IF NOT EXISTS idx_rpa_retry_queue_org_next_retry
  ON public.rpa_retry_queue (organization_id, next_retry_at)
  WHERE attempts < max_attempts;

CREATE INDEX IF NOT EXISTS idx_rpa_retry_queue_next_retry
  ON public.rpa_retry_queue (next_retry_at)
  WHERE attempts < max_attempts;

-- ── 3. Metric-event composite index (org, execution_mode, created_at) ─────
-- Only add when the events table exists; a deployment without the
-- Phase 3 baseline should skip this cleanly.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE  table_schema = 'public'
      AND  table_name   = 'community_ai_execution_metric_events'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_caime_org_mode_time
      ON public.community_ai_execution_metric_events (organization_id, execution_mode, created_at DESC);
  END IF;
END $$;

COMMIT;

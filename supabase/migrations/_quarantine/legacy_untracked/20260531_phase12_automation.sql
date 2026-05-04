-- =============================================================================
-- Phase 12 — controlled automation
--
-- Three tables + one CHECK-enforced action whitelist:
--
--   1. automation_config  — per-org settings (enabled, confidence floor,
--                           daily limit, allowed_actions). DEFAULT safe:
--                           every new row lands with enabled=false.
--   2. automation_usage   — per-(org, date) counter, the daily limit gate.
--                           Incremented on every allowed execution.
--   3. automation_logs    — one row per decision (allowed or blocked).
--                           The audit trail: no log, no automation.
--
-- Safety invariants at the schema level:
--   · allowed_actions ⊆ {reply, dm}               (CHECK)
--   · min_confidence_level ∈ {medium, high}       (CHECK)
--   · automation_config.daily_limit ≥ 0           (CHECK)
--   · automation_usage PK on (org, day) — upsert is idempotent.
-- =============================================================================

BEGIN;

-- ── 1. automation_config ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.automation_config (
  organization_id         uuid PRIMARY KEY,
  enabled                 boolean NOT NULL DEFAULT false,
  auto_reply_enabled      boolean NOT NULL DEFAULT false,
  auto_dm_enabled         boolean NOT NULL DEFAULT false,
  min_confidence_level    text NOT NULL DEFAULT 'high',
  allowed_actions         text[] NOT NULL DEFAULT ARRAY['reply']::text[],
  daily_limit             integer NOT NULL DEFAULT 20,
  created_at              timestamptz NOT NULL DEFAULT NOW(),
  updated_at              timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT automation_config_confidence_check
    CHECK (min_confidence_level IN ('medium', 'high')),
  CONSTRAINT automation_config_daily_limit_check
    CHECK (daily_limit >= 0),
  -- Hard safety gate: no destructive action type can ever enter this
  -- array. Only reply and dm are automatable; every other value is
  -- rejected at write time.
  CONSTRAINT automation_config_allowed_actions_check
    CHECK (allowed_actions <@ ARRAY['reply','dm']::text[])
);

ALTER TABLE public.automation_config ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='automation_config'
      AND policyname='service_role_all'
  ) THEN
    CREATE POLICY "service_role_all" ON public.automation_config
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

COMMENT ON TABLE public.automation_config IS
  'Per-org automation settings. Default: enabled=false, confidence=high, '
  'daily_limit=20, allowed_actions={reply}. Destructive actions are '
  'rejected by CHECK — the whitelist cannot include anything beyond '
  'reply and dm.';

-- ── 2. automation_usage ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.automation_usage (
  organization_id     uuid NOT NULL,
  day                 date NOT NULL,
  actions_executed    integer NOT NULL DEFAULT 0,
  updated_at          timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, day)
);

ALTER TABLE public.automation_usage ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='automation_usage'
      AND policyname='service_role_all'
  ) THEN
    CREATE POLICY "service_role_all" ON public.automation_usage
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- Atomic "increment if under limit" helper. SECURITY DEFINER so the
-- service role can call it; returns the new counter or NULL when the
-- increment would exceed the daily limit. Used by the automation
-- service as the final gate before dispatch.
CREATE OR REPLACE FUNCTION public.increment_automation_usage_if_allowed(
  p_org_id uuid,
  p_limit  integer
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_day         date := (NOW() AT TIME ZONE 'UTC')::date;
  v_new_count   integer;
BEGIN
  INSERT INTO public.automation_usage (organization_id, day, actions_executed, updated_at)
  VALUES (p_org_id, v_day, 1, NOW())
  ON CONFLICT (organization_id, day)
  DO UPDATE SET
    actions_executed = public.automation_usage.actions_executed + 1,
    updated_at       = NOW()
  WHERE  public.automation_usage.actions_executed < p_limit
  RETURNING actions_executed INTO v_new_count;

  RETURN v_new_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_automation_usage_if_allowed TO service_role;

-- ── 3. automation_logs ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.automation_logs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL,
  action_id            uuid,
  platform             text,
  action_type          text,
  target_id            text,
  decision             text NOT NULL CHECK (decision IN ('allowed', 'blocked')),
  reason               text,
  confidence_level     text,
  confidence_score     integer,
  pattern_type         text,
  metadata             jsonb,
  created_at           timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_logs_org_created
  ON public.automation_logs (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_logs_decision
  ON public.automation_logs (decision, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_logs_action
  ON public.automation_logs (action_id)
  WHERE action_id IS NOT NULL;

ALTER TABLE public.automation_logs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='automation_logs'
      AND policyname='service_role_all'
  ) THEN
    CREATE POLICY "service_role_all" ON public.automation_logs
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

COMMENT ON TABLE public.automation_logs IS
  'One row per automation decision. allowed → action was dispatched; '
  'blocked → reason stored. The audit surface; no log, no automation.';

COMMIT;

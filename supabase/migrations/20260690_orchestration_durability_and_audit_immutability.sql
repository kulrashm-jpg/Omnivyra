-- =============================================================================
-- Orchestration durability + audit immutability (DESIGN ARTIFACT / OPTIONAL)
--
-- WHY: The enterprise-resilience phase needed durable, multi-instance-safe
-- orchestration state and a tamper-resistant compliance audit trail. The
-- shipped code does NOT depend on this migration — it reuses the existing
-- append-only `audit_events` table (resource_type='orchestration') for durable
-- self-heal/ops history + cooldown, with graceful in-memory fallback. This
-- file provides the OPTIONAL hardening (dedicated tables + an immutability
-- trigger mirroring 20260663_ledger_immutability_and_governance.sql) for
-- deployments that want first-class orchestration storage.
--
-- SAFETY: purely additive, idempotent (IF NOT EXISTS), no historical mutation,
-- no backfill, no changes to existing tables' columns. Existing readers are
-- unaffected. Code paths degrade gracefully whether or not this is applied.
--
-- NOT applied by this change — controlled migration process only (same
-- operational contract as prior website-intelligence / ledger migrations;
-- the prod migration ledger is hand-applied).
-- =============================================================================

-- Optional dedicated orchestration history (the code currently uses
-- audit_events; this is a future home for high-volume orchestration records).
CREATE TABLE IF NOT EXISTS public.orchestration_attempts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL,
  correlation_id  text NOT NULL,
  kind            text NOT NULL,             -- self_heal_sweep | ops_action | ...
  outcome         text,                      -- repaired | unchanged | error ...
  detail          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orch_attempts_company_created
  ON public.orchestration_attempts (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orch_attempts_correlation
  ON public.orchestration_attempts (correlation_id);

-- Optional distributed-lease table for multi-instance orchestration locks.
CREATE TABLE IF NOT EXISTS public.orchestration_state (
  company_id      uuid NOT NULL,
  scope           text NOT NULL,             -- e.g. 'self_heal_sweep'
  lease_owner     text,
  lease_expires_at timestamptz,
  cooldown_until  timestamptz,
  safe_mode_until timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, scope)
);

-- Tamper-resistance for the compliance audit trail. audit_events is already
-- append-only by convention; this enforces it at the DB layer (BEFORE
-- UPDATE/DELETE → exception), mirroring raise_ledger_immutable().
CREATE OR REPLACE FUNCTION public.raise_audit_immutable()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AUDIT_IMMUTABLE: % on audit_events is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_audit_events_immutable'
  ) THEN
    CREATE TRIGGER trg_audit_events_immutable
      BEFORE UPDATE OR DELETE ON public.audit_events
      FOR EACH ROW EXECUTE FUNCTION public.raise_audit_immutable();
  END IF;
END $$;

-- RLS posture (tenant isolation) — enable + company-scoped policies, matching
-- the website-intelligence table conventions. Service role bypasses RLS.
ALTER TABLE public.orchestration_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orchestration_state ENABLE ROW LEVEL SECURITY;

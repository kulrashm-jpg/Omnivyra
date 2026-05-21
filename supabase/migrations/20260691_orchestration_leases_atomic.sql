 
 SA-- =============================================================================
-- Atomic orchestration leases + fencing (DESIGN ARTIFACT / OPTIONAL)
--
-- WHY: hardened distributed locking needs row-level CAS. This table provides
-- it; the shipped atomicLockService uses it WHEN PRESENT and otherwise falls
-- back to the existing advisory lease (audit_events) — so applying this is a
-- pure upgrade with NO regression to current advisory coordination.
--
-- CAS / fencing model:
--   - PRIMARY KEY (company_id, scope) → INSERT acquires; conflicting INSERT
--     fails atomically (lost race).
--   - Takeover of an EXPIRED lease is an UPDATE guarded by
--     (expires_at <= now()) AND fencing = <observed> → optimistic CAS.
--   - `fencing` is a monotonically increasing token; holders stamp work with
--     it so a resurrected dead worker (stale fencing) is rejected downstream.
--
-- SAFETY: purely additive, idempotent (IF NOT EXISTS), no historical mutation,
-- no backfill, no changes to existing tables. NOT applied by this change —
-- controlled migration process only (prod ledger is hand-applied).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.orchestration_leases (
  company_id   uuid        NOT NULL,
  scope        text        NOT NULL,
  lease_owner  text        NOT NULL,
  fencing      bigint      NOT NULL DEFAULT 1,
  acquired_at  timestamptz NOT NULL DEFAULT now(),
  heartbeat_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  PRIMARY KEY (company_id, scope)
);

CREATE INDEX IF NOT EXISTS idx_orch_leases_expiry
  ON public.orchestration_leases (expires_at);

ALTER TABLE public.orchestration_leases ENABLE ROW LEVEL SECURITY;

-- Optional durable orchestration state companion (cooldown / safe-mode), kept
-- separate from the lease for clean expiry semantics.
CREATE TABLE IF NOT EXISTS public.orchestration_state (
  company_id      uuid        NOT NULL,
  scope           text        NOT NULL,
  cooldown_until  timestamptz,
  safe_mode_until timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, scope)
);

ALTER TABLE public.orchestration_state ENABLE ROW LEVEL SECURITY;

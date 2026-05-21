-- =============================================================================
-- Distributed settlement locking + persistent operational metrics (additive)
--
-- Two additive deliverables for multi-instance settlement runtime safety:
--
--  (A) settlement_runtime_locks — a DB lease-lock table. A cross-process /
--      cross-container distributed lock: a holder claims `lock_key` with an
--      `owner_token` and an `expires_at` lease. A crashed holder's lease
--      expires and the next acquirer reclaims it (stale-lock-safe). This table
--      is INTENTIONALLY mutable (a lease is updated/deleted) — it is NOT an
--      append-only ledger.
--
--  (B) settlement_operational_metrics — an APPEND-ONLY operational metrics
--      ledger. Each row is one metric delta; an aggregate is SUM(delta) grouped
--      by metric_name. Replaces the previous in-memory-only counters so
--      telemetry survives a restart and is consistent across instances.
--      Immutable via the EXISTING raise_ledger_immutable() (migration 20260663).
--
-- STRICTLY internal: no public surface. NO pricing columns, NO pricing metric.
-- SANDBOX-only settlement runtime. Purely additive, idempotent (IF NOT EXISTS),
-- no historical mutation, no ledger/HOLD/billing-core change. NOT applied by
-- this change — controlled migration process only.
-- =============================================================================

-- ── (A) settlement_runtime_locks — distributed lease lock ───────────────────
CREATE TABLE IF NOT EXISTS public.settlement_runtime_locks (
  lock_key     text        PRIMARY KEY,
  owner_token  text        NOT NULL,
  acquired_at  timestamptz NOT NULL DEFAULT now(),
  -- Lease expiry — a lock whose expires_at is in the past is reclaimable.
  expires_at   timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_srl_expires
  ON public.settlement_runtime_locks (expires_at);

COMMENT ON TABLE public.settlement_runtime_locks IS
  'Distributed lease lock for settlement runtime jobs. Mutable (a lease). Stale-lock-safe via expires_at. Internal only.';

-- ── (B) settlement_operational_metrics — append-only metrics ledger ─────────
CREATE TABLE IF NOT EXISTS public.settlement_operational_metrics (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_name  text        NOT NULL
                           CHECK (metric_name IN (
                             'candidates_scanned',
                             'sessions_expired',
                             'duplicate_expiry_suppressions',
                             'stale_webhook_rejections',
                             'signature_verification_failures')),
  -- One observed delta. An aggregate is SUM(delta) grouped by metric_name.
  delta        bigint      NOT NULL,
  source       text,
  observed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_som_name
  ON public.settlement_operational_metrics (metric_name, observed_at DESC);

-- Append-only: reuse the existing immutability guard (no new trigger fn).
DROP TRIGGER IF EXISTS som_immutable_update ON public.settlement_operational_metrics;
CREATE TRIGGER som_immutable_update
  BEFORE UPDATE ON public.settlement_operational_metrics
  FOR EACH ROW EXECUTE FUNCTION public.raise_ledger_immutable();

DROP TRIGGER IF EXISTS som_immutable_delete ON public.settlement_operational_metrics;
CREATE TRIGGER som_immutable_delete
  BEFORE DELETE ON public.settlement_operational_metrics
  FOR EACH ROW EXECUTE FUNCTION public.raise_ledger_immutable();

COMMENT ON TABLE public.settlement_operational_metrics IS
  'Append-only operational metrics ledger for the sandbox settlement runtime. Internal only. NO pricing metrics. Immutable (raise_ledger_immutable).';

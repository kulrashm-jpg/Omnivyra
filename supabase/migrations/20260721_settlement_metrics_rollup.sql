-- =============================================================================
-- Settlement operational-metrics rollup (additive)
--
-- settlement_metrics_rollup — an APPEND-ONLY compaction tier over the
-- settlement_operational_metrics ledger (migration 20260720). The retention
-- job consolidates every CLOSED time bucket into one rollup row per metric
-- (total_delta = SUM of that bucket's raw deltas), so the long-term operational
-- representation is compact and a re-roll is idempotent.
--
-- The raw settlement_operational_metrics ledger and its immutability triggers
-- are UNCHANGED — this migration is purely additive. The rollup table is
-- itself append-only (immutable via the EXISTING raise_ledger_immutable(),
-- migration 20260663): a rollup row, once written, is permanent.
--
-- STRICTLY internal: no public surface. NO pricing / revenue / invoice column,
-- NO pricing metric. SANDBOX-only settlement runtime. Idempotent
-- (IF NOT EXISTS), no historical mutation, no ledger/HOLD/billing-core change.
-- NOT applied by this change — controlled migration process only.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.settlement_metrics_rollup (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The closed time bucket this rollup consolidates.
  period_start      timestamptz NOT NULL,
  period_end        timestamptz NOT NULL,
  metric_name       text        NOT NULL
                                CHECK (metric_name IN (
                                  'candidates_scanned',
                                  'sessions_expired',
                                  'duplicate_expiry_suppressions',
                                  'stale_webhook_rejections',
                                  'signature_verification_failures')),
  -- SUM(delta) of the raw rows in (period_start, metric_name).
  total_delta       bigint      NOT NULL,
  -- How many raw rows this rollup consolidated (fidelity check).
  source_row_count  integer     NOT NULL,
  rolled_up_at      timestamptz NOT NULL DEFAULT now(),
  -- A period is rolled up exactly once per metric — the idempotency anchor.
  CONSTRAINT settlement_metrics_rollup_period_metric_uq UNIQUE (period_start, metric_name)
);

CREATE INDEX IF NOT EXISTS idx_smr_period
  ON public.settlement_metrics_rollup (period_start);

-- Append-only: reuse the existing immutability guard (no new trigger fn).
DROP TRIGGER IF EXISTS smr_immutable_update ON public.settlement_metrics_rollup;
CREATE TRIGGER smr_immutable_update
  BEFORE UPDATE ON public.settlement_metrics_rollup
  FOR EACH ROW EXECUTE FUNCTION public.raise_ledger_immutable();

DROP TRIGGER IF EXISTS smr_immutable_delete ON public.settlement_metrics_rollup;
CREATE TRIGGER smr_immutable_delete
  BEFORE DELETE ON public.settlement_metrics_rollup
  FOR EACH ROW EXECUTE FUNCTION public.raise_ledger_immutable();

COMMENT ON TABLE public.settlement_metrics_rollup IS
  'Append-only compaction tier over settlement_operational_metrics. One row per (closed period, metric). Internal only. NO pricing metrics. Immutable (raise_ledger_immutable).';

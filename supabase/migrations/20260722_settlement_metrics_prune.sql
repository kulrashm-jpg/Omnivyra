-- =============================================================================
-- Rollup-gated settlement-metrics pruning (additive / hardening)
--
-- Enables the sanctioned retirement of fully rolled-up raw operational metric
-- rows WITHOUT weakening append-only guarantees:
--
--  (A) The raw settlement_operational_metrics ledger's UPDATE immutability is
--      UNCHANGED (som_immutable_update stays) — a recorded delta is never
--      altered.
--
--  (B) DELETE is no longer outright blocked but RETENTION-GATED: a delete is
--      permitted ONLY inside the sanctioned prune function (which sets a
--      transaction-local flag). Ad-hoc / arbitrary deletes still raise. There
--      is NO public prune API — the function is service-role only.
--
--  (C) settlement_metrics_prune_rolled(period[]) — a SECURITY DEFINER function
--      that deletes raw rows ONLY for periods that are fully rolled up
--      (HAVING count(DISTINCT metric_name) = 5 — all five metric classes), so
--      aggregate correctness is preserved (the rollup tier already holds those
--      periods' totals). Deterministic + idempotent (a re-run deletes 0).
--
-- The append-only settlement_metrics_rollup tier is NEVER pruned. STRICTLY
-- internal, SANDBOX-only, NO pricing. Idempotent DDL. NOT applied by this
-- change — controlled migration process only.
-- =============================================================================

-- ── (B) retention-gated delete guard ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.raise_settlement_metrics_delete_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- A delete is allowed ONLY inside the sanctioned prune function, which sets
  -- this transaction-local flag. Every other DELETE raises.
  IF coalesce(current_setting('app.settlement_metrics_prune', true), '') = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION
    'settlement_operational_metrics is append-only; deletes only via settlement_metrics_prune_rolled()';
END;
$$;

-- Replace the strict delete-immutability trigger with the retention-gated one.
-- (som_immutable_update is intentionally left in place — UPDATE stays blocked.)
DROP TRIGGER IF EXISTS som_immutable_delete ON public.settlement_operational_metrics;
DROP TRIGGER IF EXISTS som_retention_gated_delete ON public.settlement_operational_metrics;
CREATE TRIGGER som_retention_gated_delete
  BEFORE DELETE ON public.settlement_operational_metrics
  FOR EACH ROW EXECUTE FUNCTION public.raise_settlement_metrics_delete_guard();

-- ── (C) sanctioned prune function ───────────────────────────────────────────
-- Deletes raw rows ONLY for the supplied periods that are FULLY rolled up
-- (all five metric classes present in settlement_metrics_rollup). A period
-- that is partially rolled up is silently skipped — never pruned.
CREATE OR REPLACE FUNCTION public.settlement_metrics_prune_rolled(p_periods timestamptz[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer := 0;
BEGIN
  IF p_periods IS NULL OR array_length(p_periods, 1) IS NULL THEN
    RETURN 0;
  END IF;

  -- Sanction this transaction for the retention-gated delete guard.
  SET LOCAL app.settlement_metrics_prune = 'on';

  WITH complete AS (
    SELECT period_start, period_end
    FROM public.settlement_metrics_rollup
    WHERE period_start = ANY (p_periods)
    GROUP BY period_start, period_end
    HAVING count(DISTINCT metric_name) = 5   -- fully rolled up — all 5 classes
  )
  DELETE FROM public.settlement_operational_metrics som
  USING complete c
  WHERE som.observed_at >= c.period_start
    AND som.observed_at <  c.period_end;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- No public / client prune surface — service-role internal callers only.
REVOKE ALL ON FUNCTION public.settlement_metrics_prune_rolled(timestamptz[]) FROM public;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.settlement_metrics_prune_rolled(timestamptz[]) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.settlement_metrics_prune_rolled(timestamptz[]) FROM authenticated;
  END IF;
END $$;

COMMENT ON FUNCTION public.settlement_metrics_prune_rolled(timestamptz[]) IS
  'Sanctioned rollup-gated prune of settlement_operational_metrics. Deletes only fully-rolled-up periods. Deterministic + idempotent. Service-role internal only.';

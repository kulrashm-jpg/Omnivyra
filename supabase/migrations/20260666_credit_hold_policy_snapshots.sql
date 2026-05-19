-- =============================================================================
-- Phase 2 Task 7 — Immutable policy snapshot frozen at HOLD creation
--
-- WHY: today the cost a charge "should have been" is reconstructed from
-- versioned pricing tables by timestamp-join (Audit Gap #1). This freezes the
-- deterministic pricing truth at HOLD time so historical billing / invoices /
-- audits never depend on future pricing reconstruction.
--
-- WHY A SIDE TABLE (not credit_transactions.metadata):
--   * apply_credit_reservation() has NO p_metadata param and its HOLD INSERT
--     does not write the metadata column. Adding one = an RPC signature/
--     semantic change to stability-locked financial code (forbidden).
--   * The HOLD row is immutable (raise_ledger_immutable) so it cannot be
--     updated post-insert either.
--   * An append-only side table keyed by hold_transaction_id is therefore the
--     only additive, RPC-neutral, immutability-preserving option.
--
-- INHERITANCE: CONFIRM/RELEASE rows carry parent_transaction_id → the HOLD id.
-- Consumers resolve the policy for any settlement by looking up the snapshot
-- via that HOLD id. No copying; deterministic inheritance by reference.
--
-- SAFETY: purely additive. No existing table/RPC/reader/analytics/export is
-- touched. No backfill (only new HOLDs get a row; absence = legacy, handled
-- by readers as "reconstruct from pricing tables", i.e. current behavior).
-- Immutable via the EXISTING raise_ledger_immutable() trigger fn (no new
-- behavior). NOT applied by this change — controlled migration process only.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.credit_hold_policy_snapshots (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hold_transaction_id  uuid NOT NULL UNIQUE
                         REFERENCES public.credit_transactions(id) ON DELETE RESTRICT,
  organization_id      uuid NOT NULL,
  snapshot             jsonb NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chps_org
  ON public.credit_hold_policy_snapshots(organization_id, created_at);

-- Append-only: reuse the existing immutability guard (no new trigger fn).
DROP TRIGGER IF EXISTS chps_immutable_update ON public.credit_hold_policy_snapshots;
CREATE TRIGGER chps_immutable_update
  BEFORE UPDATE ON public.credit_hold_policy_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.raise_ledger_immutable();

DROP TRIGGER IF EXISTS chps_immutable_delete ON public.credit_hold_policy_snapshots;
CREATE TRIGGER chps_immutable_delete
  BEFORE DELETE ON public.credit_hold_policy_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.raise_ledger_immutable();

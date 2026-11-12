-- 20270217000036_billing_operations_update_guard  (e1, 2026-11-13; e9 ruling BLOCKING money; review: virality-05;
-- version reserved by virality-83, registry ace8394de)
--
-- billing_operations row guard. The app wrote this table with
-- `.upsert(..., { onConflict: 'idempotency_key', ignoreDuplicates: false })` (ON CONFLICT DO UPDATE), so re-opening a
-- key rewrote the row: id replaced, organization_id moved to another tenant, a settled status reset to 'initiated',
-- metadata (aiExecutionResultStore's ai_result) wiped - reproduced on the real schema by virality-6f. The app fix
-- (enterpriseBillingOrchestrator, e6f55d76c) makes open insert-or-read and close never rewrite a settled row; this
-- trigger makes the same invariants hold for EVERY writer:
--   1. id, organization_id and idempotency_key are immutable;
--   2. a FINAL row - confirmed / released / duplicate - never changes status, and its amount_charged never changes
--      (05 review: a settled charge is money; re-confirming with the SAME amount, as renderExecutor's retry does, is
--      not a change and passes);
--   3. no row returns to 'initiated' once it has left it.
-- billing_operations.status is NOT NULL DEFAULT 'initiated' (20260663), so the IN / IS DISTINCT FROM tests below
-- have no NULL path.
-- Everything else stays mutable ON PURPOSE - metadata, completed_at, failure_reason, the txn-id columns, and the
-- amount on a NON-final row: this table is the record of an operation's attempts, and the credit ledger
-- (credit_transactions) is the authority for what was charged.
-- DO NOT make 'error' / 'insufficient' final here without changing closeBillingOperation in the SAME change: the
-- orchestrator reuses the row by idempotency key and settles error -> confirmed / insufficient -> confirmed on a later
-- attempt, so a stricter trigger would turn a recoverable billing error into a permanent hard failure.
-- 'error' and 'insufficient' stay transitionable ON PURPOSE: the orchestrator may settle a recoverable row on a later
-- attempt (closeBillingOperation's FINAL set is the same three statuses), and recovery moves stuck
-- initiated / held / executed rows to 'error'. Metadata-only updates (aiExecutionResultStore save, the lifecycle
-- ai_result prune) change none of the guarded columns and pass.
-- RAISE, not silent ignore: the pre-fix app's open path falls back to a SELECT by key when its upsert errors, so a
-- deploy order where this lands before the app fix degrades to "reuse the row", never to corruption.
-- C46 (prod, read-only): 142 rows, 0 with the reset signature - the guard is expected to refuse nothing existing
-- (it only fires on UPDATE in any case).
--
-- Trigger function: SECURITY INVOKER (default), search_path pinned, EXECUTE revoked from client roles.

CREATE OR REPLACE FUNCTION public.billing_operations_row_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key THEN
    RAISE EXCEPTION 'BILLING_OPERATION_IDENTITY_IMMUTABLE: billing operation % identity columns are immutable', OLD.id
      USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status IN ('confirmed', 'released', 'duplicate') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'BILLING_OPERATION_FINAL_STATUS: billing operation % is % and cannot become %', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status IN ('confirmed', 'released', 'duplicate') AND NEW.amount_charged IS DISTINCT FROM OLD.amount_charged THEN
    RAISE EXCEPTION 'BILLING_OPERATION_FINAL_AMOUNT: billing operation % is % and its charged amount cannot change', OLD.id, OLD.status
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW.status = 'initiated' AND OLD.status IS DISTINCT FROM 'initiated' THEN
    RAISE EXCEPTION 'BILLING_OPERATION_NO_RETURN_TO_INITIATED: billing operation % cannot return from % to initiated', OLD.id, OLD.status
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.billing_operations_row_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS billing_operations_row_guard ON public.billing_operations;
CREATE TRIGGER billing_operations_row_guard
  BEFORE UPDATE ON public.billing_operations
  FOR EACH ROW EXECUTE FUNCTION public.billing_operations_row_guard();

-- Postcondition: the trigger exists, is enabled, and the function is not executable by client roles.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid = 'public.billing_operations'::regclass
       AND t.tgname = 'billing_operations_row_guard'
       AND NOT t.tgisinternal
       AND t.tgenabled <> 'D'
  ) THEN
    RAISE EXCEPTION 'billing_operations_row_guard trigger missing or disabled after migration';
  END IF;
  IF has_function_privilege('anon', 'public.billing_operations_row_guard()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.billing_operations_row_guard()', 'EXECUTE') THEN
    RAISE EXCEPTION 'billing_operations_row_guard is executable by a client role';
  END IF;
END $$;

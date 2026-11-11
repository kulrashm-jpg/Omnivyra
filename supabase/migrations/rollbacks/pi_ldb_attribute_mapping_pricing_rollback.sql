-- =============================================================================
-- ROLLBACK — PI-LDB-5 `lead_attribute_mapping` catalog rows
--            (forward: 20270211000004_pi_ldb_attribute_mapping_pricing.sql)
--
-- WHAT THIS REFUSES, AND WHY
-- --------------------------
-- Removing a pricing row is not a schema change; it is a change to how money
-- was and will be accounted. Two refusals follow from that:
--
--   1. If `usage_events` already carries rows for this action, those rows
--      reference an action key whose pricing is about to disappear. Any later
--      reconciliation, invoice or audit of that spend would then find no rate
--      to reproduce it against. The history must stay explicable.
--   2. If any credit ledger entry references the action, the same argument
--      applies with money actually moved.
--
-- So this script REFUSES rather than discarding. Deactivating is the correct
-- move in that case, not deletion — see the final section.
--
-- WHAT IT DOES NOT PROTECT
-- ------------------------
-- Nothing here prevents someone running the DELETEs by hand. The refusals are
-- a guard on THIS script, not a constraint on the tables.
--
-- MEASURE FIRST (read-only):
--
--   SELECT count(*) FROM usage_events         WHERE action_key = 'lead_attribute_mapping';
--   SELECT count(*) FROM unified_transactions WHERE action_key = 'lead_attribute_mapping';
--   SELECT count(*) FROM credit_cost_config   WHERE action_type = 'lead_attribute_mapping';
--   SELECT count(*) FROM action_pricing_config WHERE action_key  = 'lead_attribute_mapping';
--
-- ORDERING NOTE
-- -------------
-- Run this only after the application no longer passes the action. With the
-- code still deployed, removing the pricing row turns every mapping call into
-- a thrown `Missing action_pricing_config row` — which the engine survives
-- (it degrades to deterministic mapping) but which is a silent capability loss
-- rather than an intended rollback.
-- =============================================================================

DO $$
DECLARE
  v_usage  bigint := 0;
  v_ledger bigint := 0;
BEGIN
  -- `usage_events` may not exist in a partially-built environment; absence is
  -- not evidence of no usage, so the lookup is guarded and reported.
  IF to_regclass('public.usage_events') IS NULL THEN
    RAISE NOTICE 'ROLLBACK PI-LDB-5: usage_events is absent; cannot prove the action was never metered.';
  ELSE
    EXECUTE $q$ SELECT count(*) FROM public.usage_events WHERE action_key = 'lead_attribute_mapping' $q$
      INTO v_usage;
  END IF;

  -- unified_transactions, NOT credit_transactions: the latter carries
  -- transaction_type (grant/hold/confirm/...), and has no action column at all.
  -- unified_transactions.action_key is the one logUsageEvent writes, and the
  -- row it refuses in lockstep with usage_events when the action is unknown.
  IF to_regclass('public.unified_transactions') IS NULL THEN
    RAISE NOTICE 'ROLLBACK PI-LDB-5: unified_transactions is absent; cannot prove the action never settled.';
  ELSE
    EXECUTE $q$ SELECT count(*) FROM public.unified_transactions WHERE action_key = 'lead_attribute_mapping' $q$
      INTO v_ledger;
  END IF;

  IF v_usage > 0 OR v_ledger > 0 THEN
    RAISE EXCEPTION
      'ROLLBACK REFUSED: lead_attribute_mapping has % usage_events row(s) and % unified_transactions row(s). Removing its pricing would leave recorded spend with no rate to reproduce it. Deactivate instead: UPDATE action_pricing_config SET is_active = false WHERE action_key = ''lead_attribute_mapping'';',
      v_usage, v_ledger;
  END IF;

  RAISE NOTICE 'ROLLBACK PI-LDB-5: no metered usage found (usage=%s, ledger=%s); proceeding.', v_usage, v_ledger;
END
$$;

-- ── Remove the catalog rows ─────────────────────────────────────────────────
DELETE FROM action_pricing_config WHERE action_key  = 'lead_attribute_mapping';
DELETE FROM credit_cost_config    WHERE action_type = 'lead_attribute_mapping';

-- ── Postcondition ───────────────────────────────────────────────────────────
DO $$
DECLARE v_left bigint;
BEGIN
  SELECT (SELECT count(*) FROM action_pricing_config WHERE action_key  = 'lead_attribute_mapping')
       + (SELECT count(*) FROM credit_cost_config    WHERE action_type = 'lead_attribute_mapping')
    INTO v_left;
  IF v_left <> 0 THEN
    RAISE EXCEPTION 'ROLLBACK PI-LDB-5 postcondition: % catalog row(s) survived the delete.', v_left;
  END IF;
  RAISE NOTICE 'ROLLBACK PI-LDB-5: catalog rows removed. The code-side registry entry in shared/monetization/featureRegistry.ts must be reverted separately, or assertCanonicalCreditAction will resolve an action with no pricing.';
END
$$;

/**
 * Phase 3 Task 2 — Controlled activation switch for the first-class
 * usage_events/unified_transactions `ledger_hold_transaction_id` column
 * (migration 20260667).
 *
 * Default OFF. While OFF the column is NOT included in inserts, so code is
 * SAFE in environments where 20260667 has not been applied (the swallow-on-
 * error usage insert would otherwise silently drop rows on an unknown
 * column). The deterministic anchor still travels in the reserved metadata
 * key `ledger_hold_transaction_id` regardless of this flag, so reconciliation
 * stays deterministic pre- and post-activation.
 *
 * Operator turns this ON (PHASE2_LEDGER_LINK_COLUMN=true) ONLY as the
 * explicit post-migration step in the controlled deploy sequence — after
 * 20260667 is applied. Reverting = unset the env (no deploy needed); the
 * metadata fallback keeps lineage intact.
 *
 * Read at call time (not import time) so the controlled flip + restart
 * activates without code change — same pattern as phase2EnforcementGate.
 */
export function ledgerLinkColumnEnabled(): boolean {
  const v = String(process.env.PHASE2_LEDGER_LINK_COLUMN ?? '').trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'on';
}

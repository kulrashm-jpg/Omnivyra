-- =============================================================================
-- Phase 3.1 Task 1 — Lock-safe index build for the ledger-linkage columns
--
-- Splits the partial-index creation out of 20260667 so it can run with
-- CREATE INDEX CONCURRENTLY — which does NOT take a write-blocking lock on
-- usage_events / unified_transactions (both high-volume append tables).
--
-- ⚠️ NON-TRANSACTIONAL — DO NOT WRAP IN BEGIN/COMMIT.
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction block. This file
-- intentionally contains NO BEGIN;/COMMIT;. It MUST be executed by the
-- migration runner in non-transactional (autocommit) mode.
--
-- If the migration tooling wraps every file in a transaction (and cannot be
-- told otherwise for this file), DO NOT force it. Instead, run these two
-- statements manually via psql against the target DB during the controlled
-- maintenance step, then record 20260668 as applied in the migration ledger:
--
--   psql "$DATABASE_URL" -c "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_usage_events_ledger_hold ON public.usage_events(ledger_hold_transaction_id) WHERE ledger_hold_transaction_id IS NOT NULL;"
--   psql "$DATABASE_URL" -c "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_unified_txn_ledger_hold ON public.unified_transactions(ledger_hold_transaction_id) WHERE ledger_hold_transaction_id IS NOT NULL;"
--
-- EXECUTION ORDER: 20260667 (ADD COLUMN) FIRST, then this file.
--
-- SAFETY: purely additive, idempotent (IF NOT EXISTS), no table rewrite, no
-- destructive DDL. CONCURRENTLY trades a longer build for zero write-blocking.
-- ROLLBACK: DROP INDEX CONCURRENTLY IF EXISTS idx_usage_events_ledger_hold;
--           DROP INDEX CONCURRENTLY IF EXISTS idx_unified_txn_ledger_hold;
-- (also non-transactional). OFF-mode code never depends on these indexes
-- (metadata fallback covers lineage), so absence is safe.
-- NOT applied by this change — controlled migration process only.
-- =============================================================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_usage_events_ledger_hold
  ON public.usage_events(ledger_hold_transaction_id)
  WHERE ledger_hold_transaction_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_unified_txn_ledger_hold
  ON public.unified_transactions(ledger_hold_transaction_id)
  WHERE ledger_hold_transaction_id IS NOT NULL;

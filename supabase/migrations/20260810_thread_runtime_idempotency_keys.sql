-- 20260810_thread_runtime_idempotency_keys.sql
--
-- Phase 19E — Durable idempotency key persistence.
--
-- ADDS one new table backing the SupabaseIdempotencyStore:
--   - thread_runtime_idempotency_keys
--
-- ─────────────────────────────────────────────────────────────────────────────
-- DESIGN NOTES
-- ─────────────────────────────────────────────────────────────────────────────
-- - Pure new table; zero risk to existing reads/writes.
-- - RLS enabled, no policies (matches the deny-all-except-service_role
--   posture set by 20260808_thread_runtime_executions.sql).
-- - `cls` is a free-text column rather than a CHECK enum so we can extend
--   the IdempotencyClass union (currently 'node_insert', 'topology_mutation',
--   'scheduling', 'billing', 'recovery_action', 'unknown') without a
--   migration. Validation lives in the TS layer.
-- - Composite index on (execution_id, first_seen_at) supports
--   listForExecution() in O(log n + k).
-- - Optional partial index on cls for diagnostic queries (cheap).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- RISK ANALYSIS
-- ─────────────────────────────────────────────────────────────────────────────
-- - New table (empty at creation). No backfill.
-- - All columns NOT NULL where appropriate.
-- - Rollback: DROP TABLE IF EXISTS thread_runtime_idempotency_keys;
-- - Idempotent: CREATE TABLE IF NOT EXISTS + every index guarded.

CREATE TABLE IF NOT EXISTS thread_runtime_idempotency_keys (
  fingerprint_key   text PRIMARY KEY,
  cls               text NOT NULL,
  execution_id      text,
  first_seen_at     timestamp with time zone NOT NULL DEFAULT now(),
  suppressed_count  integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_thread_runtime_idempotency_execution
  ON thread_runtime_idempotency_keys (execution_id, first_seen_at);
CREATE INDEX IF NOT EXISTS idx_thread_runtime_idempotency_cls
  ON thread_runtime_idempotency_keys (cls);

-- ── Row-level security: deny-all default, service_role-only access ─────
ALTER TABLE thread_runtime_idempotency_keys ENABLE ROW LEVEL SECURITY;

GRANT ALL ON thread_runtime_idempotency_keys TO service_role;

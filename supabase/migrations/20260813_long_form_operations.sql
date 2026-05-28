-- 20260813_long_form_operations.sql
--
-- Phase 27B.2 — Long-form operation claim table.
--
-- ADDS one new table backing the long-form operation claim helper:
--   - long_form_operations
--
-- ─────────────────────────────────────────────────────────────────────────────
-- DESIGN NOTES
-- ─────────────────────────────────────────────────────────────────────────────
-- - Pure new table; zero risk to existing reads/writes.
-- - RLS enabled, no policies (deny-all-except-service_role posture).
-- - `operation_key` is the primary key. Callers compute a deterministic key
--   (e.g. `lf:${generation_id}:v1`) so re-attempting an operation INSERTs a
--   conflicting row that is suppressed by `ON CONFLICT DO NOTHING`.
-- - `status` CHECK constraint mirrors the TS LongFormOperationStatus union
--   (in_flight | completed | failed).
-- - `result_row_id` references the row that the winning attempt produced
--   (e.g. content_recommendations.id). Losers read this back so the caller
--   can return the existing result instead of regenerating.
-- - `metadata_json` is jsonb so operators can attach generation_id, asset
--   type, model, etc. for forensic reconstruction.
-- - Two indexes: status lookup (for sweep) + started_at sweep (the hot path
--   for stale-claim recovery).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- RISK ANALYSIS
-- ─────────────────────────────────────────────────────────────────────────────
-- - New table (empty at creation). No backfill.
-- - Rollback: DROP TABLE IF EXISTS long_form_operations;
-- - Idempotent: CREATE TABLE IF NOT EXISTS + every index guarded.
-- - Not applied automatically: requires explicit operator approval before
--   running through the supabase migration pipeline. The in-memory claim
--   table from the helper (when DB is unavailable) is NEVER the operational
--   default — callers configure the Supabase-backed implementation.

CREATE TABLE IF NOT EXISTS long_form_operations (
  operation_key   text PRIMARY KEY,
  status          text NOT NULL DEFAULT 'in_flight',
  started_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  result_row_id   text,
  last_error      text,
  attempt_count   integer NOT NULL DEFAULT 1,
  metadata_json   jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT long_form_operations_status_check
    CHECK (status IN ('in_flight', 'completed', 'failed'))
);

CREATE INDEX IF NOT EXISTS long_form_operations_status_idx
  ON long_form_operations (status);

CREATE INDEX IF NOT EXISTS long_form_operations_started_at_idx
  ON long_form_operations (started_at);

ALTER TABLE long_form_operations ENABLE ROW LEVEL SECURITY;

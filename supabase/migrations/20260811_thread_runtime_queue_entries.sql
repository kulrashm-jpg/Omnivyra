-- 20260811_thread_runtime_queue_entries.sql
--
-- Phase 21A — Durable distributed execution queue.
--
-- ADDS one new table backing the SupabaseExecutionQueue:
--   - thread_runtime_queue_entries
--
-- ─────────────────────────────────────────────────────────────────────────────
-- DESIGN NOTES
-- ─────────────────────────────────────────────────────────────────────────────
-- - Pure new table; zero risk to existing reads/writes.
-- - RLS enabled, no policies (matches the deny-all-except-service_role
--   posture set by 20260808_thread_runtime_executions.sql).
-- - `queue_status` CHECK constraint mirrors the TS QueueEntryStatus union
--   (queued | claimed | completed | failed | dead_lettered | cancelled).
--   Drift between SQL + TS would surface as a constraint violation on
--   insert/update — louder than a silent type mismatch.
-- - `dedup_key` is UNIQUE for live entries only (partial unique index):
--   we want duplicate enqueue to collapse onto the same live row, BUT
--   historic completed/dead-lettered/cancelled rows must coexist so the
--   forensic timeline is preserved.
-- - Claim ordering index: (run_at, priority DESC, created_at, queue_entry_id)
--   mirrors the in-memory comparator so claim semantics stay consistent.
-- - Visibility reclaim index: covers (queue_status='claimed', vis_deadline).
-- - Status lookup index: covers ad-hoc filter queries.
-- - Scheduled lookup index: covers delayed-execution scans.
-- - payload_json + result_json are jsonb (rather than text) so PostgREST
--   can return them as native JS objects.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- RISK ANALYSIS
-- ─────────────────────────────────────────────────────────────────────────────
-- - New table (empty at creation). No backfill.
-- - All columns NOT NULL where appropriate; nullable where the in-memory
--   shape is nullable (visibility_timeout_at, claimed_by_worker, result_json).
-- - Rollback: DROP TABLE IF EXISTS thread_runtime_queue_entries;
-- - Idempotent: CREATE TABLE IF NOT EXISTS + every index guarded.
-- - Not applied automatically: this file is committed but requires explicit
--   operator approval before being run through the supabase migration
--   pipeline. The in-memory queue from Phase 20A remains the operational
--   default until the queue is opted into.

CREATE TABLE IF NOT EXISTS thread_runtime_queue_entries (
  queue_entry_id          text PRIMARY KEY,
  execution_id            text NOT NULL,
  runtime_session_id      text,
  company_id              uuid NOT NULL,
  kind                    text NOT NULL,
  queue_status            text NOT NULL DEFAULT 'queued',
  priority                integer NOT NULL DEFAULT 50,
  attempts                integer NOT NULL DEFAULT 0,
  max_attempts            integer NOT NULL DEFAULT 5,
  scheduled_for           timestamp with time zone NOT NULL DEFAULT now(),
  visibility_timeout_at   timestamp with time zone,
  claimed_by_worker       text,
  claimed_at              timestamp with time zone,
  dedup_key               text NOT NULL,
  payload_json            jsonb,
  result_json             jsonb,
  failure_reason          text,
  created_at              timestamp with time zone NOT NULL DEFAULT now(),
  updated_at              timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT chk_queue_status CHECK (queue_status IN (
    'queued', 'claimed', 'completed', 'failed', 'dead_lettered', 'cancelled'
  )),
  CONSTRAINT chk_queue_kind CHECK (kind IN (
    'execution_start', 'execution_recovery', 'execution_continuation'
  )),
  CONSTRAINT chk_queue_priority CHECK (priority BETWEEN 0 AND 100),
  CONSTRAINT chk_queue_attempts CHECK (attempts >= 0 AND attempts <= max_attempts + 5)
);

-- ── Indexes ──────────────────────────────────────────────────────────

-- Claim ordering (the hot path) — covers WHERE queue_status IN ('queued','claimed')
-- AND scheduled_for <= now() AND visibility_timeout_at <= now()
CREATE INDEX IF NOT EXISTS idx_thread_runtime_queue_claim_order
  ON thread_runtime_queue_entries (queue_status, scheduled_for, priority DESC, created_at, queue_entry_id);

-- Visibility-reclaim sweep — covers WHERE queue_status='claimed' AND vis<=now
CREATE INDEX IF NOT EXISTS idx_thread_runtime_queue_visibility_sweep
  ON thread_runtime_queue_entries (queue_status, visibility_timeout_at)
  WHERE queue_status = 'claimed';

-- Dedup lookup — partial unique on live entries (queued | claimed | failed).
-- completed/dead_lettered/cancelled rows are excluded so historic dedup
-- keys can collide with fresh enqueue.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_thread_runtime_queue_live_dedup
  ON thread_runtime_queue_entries (dedup_key)
  WHERE queue_status IN ('queued', 'claimed', 'failed');

-- Status lookup — covers ad-hoc operator queries.
CREATE INDEX IF NOT EXISTS idx_thread_runtime_queue_status
  ON thread_runtime_queue_entries (queue_status, updated_at DESC);

-- Scheduled-execution lookup — covers delayed-task scans.
CREATE INDEX IF NOT EXISTS idx_thread_runtime_queue_scheduled
  ON thread_runtime_queue_entries (scheduled_for)
  WHERE queue_status = 'queued';

-- Per-execution lookup — covers listByExecution() + forensic queries.
CREATE INDEX IF NOT EXISTS idx_thread_runtime_queue_by_execution
  ON thread_runtime_queue_entries (execution_id, created_at DESC);

-- ── Row-level security: deny-all default, service_role-only access ─────
ALTER TABLE thread_runtime_queue_entries ENABLE ROW LEVEL SECURITY;

GRANT ALL ON thread_runtime_queue_entries TO service_role;

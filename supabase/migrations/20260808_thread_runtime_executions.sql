-- 20260808_thread_runtime_executions.sql
--
-- Phase 15 — Durable execution orchestration substrate.
--
-- ADDS three new tables backing the ExecutionStore interface:
--   - thread_runtime_executions   (one row per execution)
--   - thread_runtime_checkpoints  (incremental checkpoints per execution)
--   - thread_runtime_leases       (worker leases per execution; only one
--                                   active lease per execution at a time)
--
-- ─────────────────────────────────────────────────────────────────────────────
-- DESIGN NOTES
-- ─────────────────────────────────────────────────────────────────────────────
-- - Pure new tables; zero risk to existing reads/writes.
-- - RLS enabled, no policies (same deny-all-except-service_role posture
--   as 20260808_thread_runtime_events.sql; this codebase routes tenant
--   access through assertTenantAccess at the API endpoint boundary, not
--   via a join-able membership table).
-- - Status, phase, recovery_state, and class CHECK constraints enforce
--   the lifecycle contract from the TypeScript types — drift between SQL
--   and TS would produce a constraint violation at insert time.
-- - Indexes target the hot paths: list-by-status, list-by-thread,
--   active-lease-by-execution, expired-lease sweep.
-- - Single unique-active-lease index ensures the LeaseGovernor's "at most
--   one live lease per execution" invariant is enforced in the database,
--   not just in application code.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- RISK ANALYSIS
-- ─────────────────────────────────────────────────────────────────────────────
-- - All three tables are new (empty at creation). No backfill.
-- - All columns NOT NULL where appropriate; nullable only where the
--   in-memory shape is nullable.
-- - Rollback:
--     DROP TABLE IF EXISTS thread_runtime_leases;
--     DROP TABLE IF EXISTS thread_runtime_checkpoints;
--     DROP TABLE IF EXISTS thread_runtime_executions;
-- - Idempotent: CREATE TABLE IF NOT EXISTS + every index guarded.

-- ── thread_runtime_executions ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS thread_runtime_executions (
  execution_id          text PRIMARY KEY,
  runtime_session_id    text NOT NULL,
  thread_id             text NOT NULL,
  company_id            uuid NOT NULL,
  orchestration_phase   text NOT NULL,
  execution_status      text NOT NULL DEFAULT 'pending',
  execution_owner       text,
  retry_count           integer NOT NULL DEFAULT 0,
  recovery_state        text NOT NULL DEFAULT 'idle',
  started_at            timestamp with time zone NOT NULL DEFAULT now(),
  heartbeat_at          timestamp with time zone,
  completed_at          timestamp with time zone,
  failure_reason        text,
  replay_checkpoint_id  text,
  created_at            timestamp with time zone NOT NULL DEFAULT now(),
  updated_at            timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT chk_exec_status CHECK (execution_status IN (
    'pending', 'running', 'waiting', 'recovering', 'failed', 'completed', 'abandoned'
  )),
  CONSTRAINT chk_exec_phase CHECK (orchestration_phase IN (
    'precheck', 'generation', 'persistence', 'topology_settle', 'recovery', 'finalize'
  )),
  CONSTRAINT chk_exec_recovery_state CHECK (recovery_state IN (
    'idle', 'attempting', 'stabilizing', 'reconciled', 'failed'
  ))
);

CREATE INDEX IF NOT EXISTS idx_thread_runtime_executions_company_status
  ON thread_runtime_executions (company_id, execution_status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_thread_runtime_executions_thread
  ON thread_runtime_executions (company_id, thread_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_thread_runtime_executions_session
  ON thread_runtime_executions (company_id, runtime_session_id);

-- ── thread_runtime_checkpoints ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS thread_runtime_checkpoints (
  checkpoint_id                  text PRIMARY KEY,
  execution_id                   text NOT NULL REFERENCES thread_runtime_executions(execution_id) ON DELETE CASCADE,
  taken_at                       timestamp with time zone NOT NULL DEFAULT now(),
  phase                          text NOT NULL,
  completed_node_operation_ids   text[] NOT NULL DEFAULT '{}',
  pending_node_operation_ids     text[] NOT NULL DEFAULT '{}',
  pending_topology_mutation_ids  text[] NOT NULL DEFAULT '{}',
  recovery_progress              jsonb,
  replay_continuity              jsonb,

  CONSTRAINT chk_checkpoint_phase CHECK (phase IN (
    'precheck', 'generation', 'persistence', 'topology_settle', 'recovery', 'finalize'
  ))
);

CREATE INDEX IF NOT EXISTS idx_thread_runtime_checkpoints_execution
  ON thread_runtime_checkpoints (execution_id, taken_at DESC);

-- ── thread_runtime_leases ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS thread_runtime_leases (
  lease_id          text PRIMARY KEY,
  execution_id      text NOT NULL REFERENCES thread_runtime_executions(execution_id) ON DELETE CASCADE,
  owner_worker_id   text NOT NULL,
  acquired_at       timestamp with time zone NOT NULL DEFAULT now(),
  expires_at        timestamp with time zone NOT NULL,
  released          boolean NOT NULL DEFAULT FALSE,
  created_at        timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_thread_runtime_leases_execution
  ON thread_runtime_leases (execution_id, released, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_thread_runtime_leases_expired
  ON thread_runtime_leases (expires_at)
  WHERE released = FALSE;

-- ── At-most-one-active-lease-per-execution invariant ───────────────────
-- A partial unique index enforces single-writer per execution at the
-- database level (defense in depth alongside the application-level lease
-- governor). When released=true the row is excluded from the unique scope,
-- so historic released leases can coexist.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_thread_runtime_leases_active
  ON thread_runtime_leases (execution_id)
  WHERE released = FALSE;

-- ── Row-level security: deny-all default, service_role-only access ─────
-- Same posture as thread_runtime_events. The durable execution layer is
-- operated server-side via the service-role client. Authenticated client
-- access is denied; service_role bypasses RLS.
ALTER TABLE thread_runtime_executions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE thread_runtime_checkpoints  ENABLE ROW LEVEL SECURITY;
ALTER TABLE thread_runtime_leases       ENABLE ROW LEVEL SECURITY;

GRANT ALL ON thread_runtime_executions  TO service_role;
GRANT ALL ON thread_runtime_checkpoints TO service_role;
GRANT ALL ON thread_runtime_leases      TO service_role;

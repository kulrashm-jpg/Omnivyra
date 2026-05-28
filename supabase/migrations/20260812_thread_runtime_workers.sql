-- 20260812_thread_runtime_workers.sql
--
-- Phase 21B — Durable distributed worker registry.
--
-- ADDS one new table backing the SupabaseWorkerRegistry:
--   - thread_runtime_workers
--
-- ─────────────────────────────────────────────────────────────────────────────
-- DESIGN NOTES
-- ─────────────────────────────────────────────────────────────────────────────
-- - Pure new table; zero risk to existing reads/writes.
-- - RLS enabled, no policies (deny-all-except-service_role posture).
-- - `worker_status` CHECK constraint mirrors the TS WorkerStatus union
--   (active | draining | recovering | stale | offline).
-- - `worker_kind` CHECK constraint mirrors the TS WorkerKind union.
-- - `capabilities_json` is jsonb so PostgREST returns the structured array.
-- - process_metadata stores caller-supplied identity (hostname,
--   processIdentity, k8s pod id, etc.) for forensic timeline reconstruction.
-- - active_execution_count + recovery_load are integers so the throughput
--   governor can read them cheaply.
-- - heartbeat_at is the system-of-record for stale detection. Indexed.
-- - Two indexes: status lookup + heartbeat sweep (the hot paths).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- RISK ANALYSIS
-- ─────────────────────────────────────────────────────────────────────────────
-- - New table (empty at creation). No backfill.
-- - Rollback: DROP TABLE IF EXISTS thread_runtime_workers;
-- - Idempotent: CREATE TABLE IF NOT EXISTS + every index guarded.
-- - Not applied automatically: requires explicit operator approval before
--   running through the supabase migration pipeline. The in-memory
--   coordinator from Phase 20B remains the operational default until the
--   registry is opted into.

CREATE TABLE IF NOT EXISTS thread_runtime_workers (
  worker_id              text PRIMARY KEY,
  worker_kind            text NOT NULL,
  worker_status          text NOT NULL DEFAULT 'active',
  capabilities_json      jsonb NOT NULL DEFAULT '[]'::jsonb,
  active_execution_count integer NOT NULL DEFAULT 0,
  recovery_load          integer NOT NULL DEFAULT 0,
  hostname               text,
  process_identity       text,
  registered_at          timestamp with time zone NOT NULL DEFAULT now(),
  heartbeat_at           timestamp with time zone,
  drain_started_at       timestamp with time zone,
  offline_at             timestamp with time zone,
  process_metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at             timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT chk_worker_status CHECK (worker_status IN (
    'active', 'draining', 'recovering', 'stale', 'offline'
  )),
  CONSTRAINT chk_worker_kind CHECK (worker_kind IN (
    'queue_worker', 'recovery_worker', 'cron', 'standalone', 'test'
  )),
  CONSTRAINT chk_worker_active_count CHECK (active_execution_count >= 0),
  CONSTRAINT chk_worker_recovery_load CHECK (recovery_load >= 0)
);

-- ── Indexes ──────────────────────────────────────────────────────────

-- Status lookup — covers WHERE worker_status IN (...) ORDER BY registered_at
CREATE INDEX IF NOT EXISTS idx_thread_runtime_workers_status
  ON thread_runtime_workers (worker_status, registered_at);

-- Heartbeat sweep — covers WHERE worker_status != 'offline' AND heartbeat_at < cutoff
CREATE INDEX IF NOT EXISTS idx_thread_runtime_workers_heartbeat
  ON thread_runtime_workers (heartbeat_at)
  WHERE worker_status NOT IN ('offline');

-- Kind lookup — covers WHERE worker_kind = '...' ad-hoc operator queries.
CREATE INDEX IF NOT EXISTS idx_thread_runtime_workers_kind
  ON thread_runtime_workers (worker_kind, worker_status);

-- ── Row-level security: deny-all default, service_role-only access ─────
ALTER TABLE thread_runtime_workers ENABLE ROW LEVEL SECURITY;

GRANT ALL ON thread_runtime_workers TO service_role;

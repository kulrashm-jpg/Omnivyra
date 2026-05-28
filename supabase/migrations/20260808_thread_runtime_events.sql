-- 20260808_thread_runtime_events.sql
--
-- Phase 14.1 — Persistent trace store for thread runtime observability.
--
-- ADDS a new append-only table `thread_runtime_events` that backs the
-- PersistentTraceStore interface. Multi-instance deployments can converge
-- runtime traces here for durable replay, cross-instance correlation, and
-- long-horizon analytics.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- DESIGN NOTES
-- ─────────────────────────────────────────────────────────────────────────────
-- - Append-only: no UPDATE / DELETE policies are granted. Truncation is
--   service-role-only via direct connection.
-- - Idempotent: PRIMARY KEY on (event_id) so duplicate transport inserts
--   resolve to no-op via ON CONFLICT DO NOTHING at the application layer.
-- - RLS: company-scoped read access. The same RLS pattern as
--   scheduled_posts (companyId is the boundary).
-- - Indexes target the hot read paths:
--     - replay reconstruction by (company_id, runtime_session_id, orchestration_sequence)
--     - timeline reconstruction by (company_id, thread_id, timestamp)
--     - distributed correlation by (company_id, correlation_id, timestamp)
--     - failure-only queries by (company_id, severity, timestamp) with a
--       partial index restricted to high/critical for cheap dashboards
-- - payload_json holds the event-specific fields not normalized into columns.
-- - replay_version supports schema evolution (bump when the payload shape changes).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- RISK ANALYSIS
-- ─────────────────────────────────────────────────────────────────────────────
-- - New table; zero risk to existing reads/writes.
-- - All columns NOT NULL except payload_json and correlation_id.
-- - No backfill needed (empty table at creation).
-- - Rollback:
--     DROP TABLE IF EXISTS thread_runtime_events;
--   (only safe if no consumer still depends on the data; the application
--    falls back to the in-memory store via the pluggable interface.)
-- - Idempotent: CREATE TABLE IF NOT EXISTS + every index is also guarded
--   so re-running is a no-op.

CREATE TABLE IF NOT EXISTS thread_runtime_events (
  event_id              text PRIMARY KEY,
  runtime_session_id    text NOT NULL,
  thread_id             text NOT NULL,
  company_id            uuid NOT NULL,
  orchestration_sequence integer NOT NULL,
  event_type            text NOT NULL,
  severity              text NOT NULL DEFAULT 'info',
  timestamp             timestamp with time zone NOT NULL,
  payload_json          jsonb,
  source_surface        text NOT NULL DEFAULT 'unknown',
  correlation_id        text,
  replay_version        integer NOT NULL DEFAULT 1,
  created_at            timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT chk_thread_runtime_event_type CHECK (event_type IN (
    'session_start', 'node_create', 'node_edit', 'node_reorder',
    'persist_attempt', 'persist_success', 'persist_failure',
    'join_attempt', 'join_success', 'join_failure',
    'refresh_observed',
    'recovery_attempt', 'recovery_success', 'recovery_failure',
    'session_end'
  )),
  CONSTRAINT chk_thread_runtime_severity CHECK (severity IN (
    'info', 'low', 'medium', 'high', 'critical'
  )),
  CONSTRAINT chk_thread_runtime_source_surface CHECK (source_surface IN (
    'server_scheduler', 'client_scheduler', 'editor', 'recovery', 'cron', 'unknown'
  ))
);

-- ── Indexes for the four hot read paths ──────────────────────────────────

-- Replay reconstruction within a session
CREATE INDEX IF NOT EXISTS idx_thread_runtime_events_session
  ON thread_runtime_events (company_id, runtime_session_id, orchestration_sequence);

-- Timeline reconstruction for a thread (all sessions, chronological)
CREATE INDEX IF NOT EXISTS idx_thread_runtime_events_thread_time
  ON thread_runtime_events (company_id, thread_id, timestamp);

-- Distributed correlation lookups
CREATE INDEX IF NOT EXISTS idx_thread_runtime_events_correlation
  ON thread_runtime_events (company_id, correlation_id, timestamp)
  WHERE correlation_id IS NOT NULL;

-- Failure-only dashboards
CREATE INDEX IF NOT EXISTS idx_thread_runtime_events_failures
  ON thread_runtime_events (company_id, timestamp DESC, severity)
  WHERE severity IN ('high', 'critical');

-- ── Row-level security: deny-all default, service_role-only access ─────
--
-- RLS is ENABLED with NO POLICIES. In Postgres + Supabase, this is the
-- canonical "deny-all for authenticated users; service_role bypasses RLS"
-- posture. The thread runtime observability layer is operated entirely
-- server-side via the service-role client — there is no use case for
-- client-side authenticated reads/writes against this table.
--
-- Why no membership-join policies?
--   This codebase routes tenant access through `assertTenantAccess(...)`
--   (see backend/services/userContextService.ts) rather than a join-based
--   membership table. There is no `company_members` / `org_members` /
--   `tenant_members` table to join against in this database (verified
--   2026-05-25 via information_schema scan). API endpoints enforce
--   company scope at the request boundary instead.
--
-- If client-side access becomes a requirement later, write a follow-up
-- migration that adds policies routing through the canonical
-- tenant-access RPC (assertTenantAccess) — do NOT join against a
-- membership table that does not exist in this schema.

ALTER TABLE thread_runtime_events ENABLE ROW LEVEL SECURITY;

-- service_role gets full access (bypasses RLS anyway; granted explicitly
-- so the intent is documented in the schema, not just in policy).
GRANT ALL ON thread_runtime_events TO service_role;

-- Phase 13 — Targeted performance indexes for hot query paths added across
-- Phases 9-12. All additions are CREATE INDEX IF NOT EXISTS (idempotent).
-- No schema mutations. No constraint changes. No row mutations.
--
-- Each index is justified by a specific query pattern in the Phase 13
-- audit; partial indexes are used where selectivity is high (small
-- B-tree footprint, large per-query speedup). Composite indexes are
-- added where the existing single-column indexes force a filter step.

-- ---------------------------------------------------------------------------
-- INCIDENTS — combined (status, severity) filter scans on the console.
-- Existing: (org,status,created_at DESC), (org,severity,created_at DESC).
-- Add: (org, severity, status, created_at DESC) for combined-filter UI.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_incidents_org_sev_status_recent
  ON intelligence_incidents (organization_id, severity, status, created_at DESC);

-- Partial index for open / triaging / mitigating incidents — the "live"
-- subset the operator console queries most often. Tight selectivity.
CREATE INDEX IF NOT EXISTS idx_incidents_org_live
  ON intelligence_incidents (organization_id, created_at DESC)
  WHERE status IN ('open','triaging','mitigating');

-- ---------------------------------------------------------------------------
-- SEMANTIC INDEXING PARTITIONS — list-by-job already covered; add a partial
-- index for non-terminal partitions to accelerate the worker probe path.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_semantic_partitions_org_active
  ON semantic_indexing_partitions (organization_id, updated_at DESC)
  WHERE status IN ('queued','running');

-- ---------------------------------------------------------------------------
-- REPLAY PARTITIONS — same shape; the resume path queries non-terminal rows.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_replay_partitions_org_active
  ON replay_partitions (organization_id, updated_at DESC)
  WHERE status IN ('queued','running');

-- ---------------------------------------------------------------------------
-- LISTENING EXECUTIONS — telemetry queries filter by status; add partial.
-- (listening_executions ships from Phase 3; index is additive.)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_listening_executions_org_active
  ON listening_executions (organization_id, created_at DESC)
  WHERE status IN ('queued','running');

-- ---------------------------------------------------------------------------
-- MARKETPLACE CONNECTORS — Phase 12 customer-ops scoring filters by
-- (org, rollout_state='active'). Add a partial for the active subset.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_marketplace_connectors_org_active
  ON marketplace_connector_definitions (organization_id, updated_at DESC)
  WHERE rollout_state = 'active';

-- ---------------------------------------------------------------------------
-- SAFETY RAILS / SAFEGUARDS — non-green subset is what the convergence
-- service + UI dashboard query. UNIQUE(org, rail_kind) already exists.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_safety_rails_org_non_green
  ON operational_safety_rails (organization_id)
  WHERE state IN ('warn','triggered','overridden','frozen');

CREATE INDEX IF NOT EXISTS idx_safeguards_org_active
  ON production_safeguard_states (organization_id)
  WHERE state IN ('tripped','recovering','overridden');

-- ---------------------------------------------------------------------------
-- ROLLOUT PLANS — the deployment health snapshot iterates each status.
-- A composite (org, status) suffices over the existing (org, status,
-- updated_at DESC), but the existing index already covers this path.
-- Add a partial for in-flight plans (drafted/approved/executing) — the
-- subset humans look at most.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_rollout_plans_org_inflight
  ON production_rollout_plans (organization_id, updated_at DESC)
  WHERE status IN ('drafted','approved','executing');

-- ---------------------------------------------------------------------------
-- STABILIZATION WINDOWS — `isPlatformFrozen()` queries `(org, state='active',
-- freeze_scope IN (...))` on every advisory check. Partial index makes this
-- a constant-time lookup.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_stab_windows_org_active_scope
  ON platform_stabilization_windows (organization_id, freeze_scope, activated_at DESC)
  WHERE state = 'active';

-- ---------------------------------------------------------------------------
-- ANALYTICS WAREHOUSE — bucket-range scans by (org, fact_kind, bucket_start)
-- already indexed. Add a partial for the most recent 90 days where reports
-- live; PostgreSQL planner uses partial indexes when the WHERE clause
-- matches. Skip if planner can't statically prove the predicate.
-- (Left commented intentionally: time-based partial indexes drift; the
-- existing composite is correct and stable.)

-- ---------------------------------------------------------------------------
-- SAVED VIEWS — owner-scoped + shared lookups. Partial for shared subset.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_saved_views_org_shared
  ON saved_intelligence_views (organization_id, view_kind, updated_at DESC)
  WHERE shared = TRUE;

-- ---------------------------------------------------------------------------
-- INCIDENT TIMELINE — "by actor" lookup pattern: append-only event log
-- queried both by incident_id (covered) and increasingly by actor.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_incident_timeline_org_actor
  ON incident_timeline_entries (organization_id, actor_user_id, created_at DESC)
  WHERE actor_user_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- COPILOT RESPONSES — list-by-subject already covered; add an actor index
-- for the audit query "what has this user requested".
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_copilot_org_actor
  ON copilot_responses (organization_id, requested_by, created_at DESC)
  WHERE requested_by IS NOT NULL;

-- ---------------------------------------------------------------------------
-- SUPPORT SNAPSHOTS — covering index for the lightweight list endpoint that
-- selects (id, snapshot_kind, payload_hash, row_count, byte_size, status,
-- created_at). PostgreSQL INCLUDE keeps the columns alongside the index
-- so the table heap is not touched for list queries.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_support_snapshots_list_cover
  ON support_snapshots (organization_id, snapshot_kind, created_at DESC)
  INCLUDE (status, payload_hash, row_count, byte_size);

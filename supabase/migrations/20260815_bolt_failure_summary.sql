-- ============================================================
-- BOLT Failure Summary — structured per-failure diagnostic row
-- ============================================================
-- Companion table to bolt_execution_runs. Each row is one ATTEMPT
-- to persist a failure (a single run can produce multiple rows when
-- both a per-stage catch AND the outer pipeline catch fire). This
-- is intentional: dashboards filter by `is_terminal=true` for one
-- row per failed run, while operators investigating a single run
-- can replay every catch site to see the full failure timeline.
--
-- This table is ADDITIVE — bolt_execution_runs continues to carry
-- raw_error_message / error_stack / failed_stage / error_message
-- exactly as before. No code path that reads from those columns
-- changes. The summary row simply normalizes the same data into a
-- queryable, classified shape for the failure dashboard.
--
-- Hard requirement from the implementation spec:
--   "Do NOT change planner behavior. Do NOT change generation
--    behavior. Only improve diagnosis and visibility."
-- This migration adds a new table and writes to it from the same
-- catch path that already calls persistPipelineFailure. The planner
-- never reads from this table — it is operator-facing only.
--
-- Idempotent via IF NOT EXISTS. Safe to apply to a partially-
-- applied DB.
-- ============================================================

CREATE TABLE IF NOT EXISTS bolt_failure_summary (
  -- Surrogate so the (run_id, stage) pair can repeat — every
  -- catch-site invocation gets its own row.
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Run + campaign + tenancy. company_id is denormalized so RLS
  -- and per-tenant queries don't have to round-trip through runs.
  run_id                  UUID NOT NULL,
  campaign_id             UUID,
  company_id              UUID,
  -- Optional — strategy_id is not always plumbed (BOLT-text creates
  -- the campaign inside source-recommendation, so failures earlier
  -- in the pipeline have no strategy id yet). Captured best-effort.
  strategy_id             TEXT,

  -- Where the failure happened. failed_stage is the catch-site
  -- name (`validate-execution-config`, `pipeline-outer`, …) and
  -- current_stage is whatever the run row had loaded at the time
  -- (often equal but can differ when the outer catch fires after
  -- a stage update raced ahead).
  failed_stage            TEXT NOT NULL,
  current_stage           TEXT,

  -- Pipeline + surface tags, mirror the columns the per-failure
  -- persister already writes onto bolt_execution_runs.
  pipeline_mode           TEXT,
  campaign_type           TEXT,

  -- Raw diagnostic payload. raw_error_message is the message we
  -- ALSO write to bolt_execution_runs.raw_error_message — kept
  -- here too so the summary table is self-contained for queries.
  raw_error_message       TEXT,
  -- Truncated stack excerpt (~2KB). The full stack lives on the
  -- run row; this is the short version dashboards can display
  -- without paginating multi-KB strings.
  stack_excerpt           TEXT,
  -- Provider attribution when known: 'openai', 'anthropic',
  -- 'supabase', 'redis', 'bullmq', 'self' (planner-internal),
  -- 'unknown'. Derived by classifyBoltFailure.
  provider                TEXT,

  -- Normalized classification. Constrained to the 10 categories
  -- the spec calls out + 'OTHER' as a safety valve. Existing
  -- normalizePipelineError.type still drives operator-facing dashboards
  -- via the run row; this column is the orthogonal classifier used
  -- for the failure breakdown view.
  normalized_error_type   TEXT,
  -- Retriable hint surfaced to the dashboard (mirrors the same
  -- field on normalizePipelineError so operators have it without
  -- joining back to the run row).
  retriable               BOOLEAN,

  -- Strategy differential — captured at failure time so operators
  -- can compare the failing strategy to a sibling success without
  -- chasing it across campaign_versions. Free-form JSONB; the keys
  -- are documented inside the persistence helper.
  strategy_snapshot       JSONB,

  -- Lifecycle. is_terminal is true when this row represents the
  -- run's FINAL failure (the outer pipeline catch or the per-stage
  -- catch that the outer catch never overrode). The persistence
  -- helper sets this on the most recent row for a run.
  is_terminal             BOOLEAN NOT NULL DEFAULT FALSE,
  occurred_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Dashboard indexes ────────────────────────────────────────────
-- "Show me failures for this campaign" / "this run" — the two
-- most common operator queries.
CREATE INDEX IF NOT EXISTS idx_bolt_failure_summary_run_id
  ON bolt_failure_summary (run_id);
CREATE INDEX IF NOT EXISTS idx_bolt_failure_summary_campaign_id
  ON bolt_failure_summary (campaign_id)
  WHERE campaign_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bolt_failure_summary_company_id
  ON bolt_failure_summary (company_id)
  WHERE company_id IS NOT NULL;

-- Dashboard rollups: by stage, by provider, by type. These all
-- need recency, so they're (col, occurred_at DESC).
CREATE INDEX IF NOT EXISTS idx_bolt_failure_summary_stage_time
  ON bolt_failure_summary (failed_stage, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_bolt_failure_summary_provider_time
  ON bolt_failure_summary (provider, occurred_at DESC)
  WHERE provider IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bolt_failure_summary_type_time
  ON bolt_failure_summary (normalized_error_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_bolt_failure_summary_campaign_type_time
  ON bolt_failure_summary (campaign_type, occurred_at DESC)
  WHERE campaign_type IS NOT NULL;

-- Terminal-only view of failures — the dashboard's default filter.
CREATE INDEX IF NOT EXISTS idx_bolt_failure_summary_terminal_time
  ON bolt_failure_summary (occurred_at DESC)
  WHERE is_terminal = TRUE;

-- ─── RLS ──────────────────────────────────────────────────────
-- Service-role only. This is an operator/admin diagnostic table;
-- end users never see it directly (the super-admin endpoint pulls
-- through the service role like every other planner-control view).
ALTER TABLE bolt_failure_summary ENABLE ROW LEVEL SECURITY;

-- No SELECT/INSERT/UPDATE policies for anon or authenticated —
-- the service role bypasses RLS for writes (persistPipelineFailure)
-- and the super-admin endpoint authenticates via requireCapability
-- before issuing the read.

COMMENT ON TABLE bolt_failure_summary IS
  'Per-failure diagnostic summary for BOLT runs. Additive companion to bolt_execution_runs; planner never reads this table. See backend/services/boltPipelineFailurePersistence.ts.';
COMMENT ON COLUMN bolt_failure_summary.is_terminal IS
  'True for the run-final failure row. Dashboards default-filter on this to get one row per failed run.';
COMMENT ON COLUMN bolt_failure_summary.strategy_snapshot IS
  'Snapshot of strategy/execution-config fields at failure time. Free-form JSONB; keys documented in captureStrategySnapshot.ts.';

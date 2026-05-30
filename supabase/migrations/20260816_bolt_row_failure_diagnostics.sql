-- ============================================================
-- BOLT Row-Level Failure Diagnostics
-- ============================================================
-- Companion to bolt_failure_summary (one row per RUN-level failure).
-- This table records ROW-level failures — when a single generated
-- daily-plan row, scheduled-post row, or creator-asset row fails
-- validation or persistence.
--
-- The closure pass added DAILY_PLAN_INVALID_PLATFORM,
-- DAILY_PLAN_INVALID_CONTENT_TYPE, DAILY_PLAN_INVALID_ACTIVITY,
-- DAILY_PLAN_INVALID_WEEK, DAILY_PLAN_INVALID_CTA, and
-- DAILY_PLAN_UNSCHEDULABLE error codes. Each rejection writes one
-- row here so operators can see "this run rejected 3 rows for
-- DAILY_PLAN_INVALID_CONTENT_TYPE" without parsing log streams.
--
-- Linked to bolt_failure_summary by run_id. A run may have:
--   - N rows here AND a run-level failure (the bad rows caused the
--     stage to throw)
--   - N rows here AND no run-level failure (rows were rejected
--     individually but the stage continued — partial-success path)
--
-- Service-role only (RLS-enabled but no policies for anon/authed —
-- super-admin endpoint reads via service role).
--
-- Idempotent via IF NOT EXISTS.
-- ============================================================

CREATE TABLE IF NOT EXISTS bolt_row_failure_diagnostics (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Lineage. run_id is the BOLT run; campaign_id makes per-campaign
  -- queries cheap; daily_plan_id is the offending row when available.
  run_id          UUID NOT NULL,
  campaign_id     UUID,
  company_id      UUID,

  -- Row identifiers (all optional — the row may not have been
  -- persisted yet when the validator caught it).
  daily_plan_id   UUID,
  week_number     INTEGER,
  activity_id     TEXT,
  platform        TEXT,
  content_type    TEXT,

  -- Classification. failure_code is a BOLT_ERROR_CODE; failure_category
  -- mirrors BOLT_ERROR_CODE_CATEGORY (denormalized for dashboard joins).
  failure_code      TEXT NOT NULL,
  failure_category  TEXT,
  failure_message   TEXT NOT NULL,
  failure_field     TEXT,
  -- Free-form JSON for caller-specific context (eligibility reasons,
  -- platform mismatches, etc.). Kept as JSONB so dashboards can extract
  -- specific fields without a schema migration.
  failure_details   JSONB,

  -- Which stage was running when the row was rejected.
  stage             TEXT,

  occurred_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Per-run lookup — the operator's "show me everything that failed
-- in this run" query.
CREATE INDEX IF NOT EXISTS idx_bolt_row_failure_run_id
  ON bolt_row_failure_diagnostics (run_id);
CREATE INDEX IF NOT EXISTS idx_bolt_row_failure_campaign_id
  ON bolt_row_failure_diagnostics (campaign_id)
  WHERE campaign_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bolt_row_failure_company_id
  ON bolt_row_failure_diagnostics (company_id)
  WHERE company_id IS NOT NULL;

-- Dashboard rollups: by code / platform / content_type over a window.
CREATE INDEX IF NOT EXISTS idx_bolt_row_failure_code_time
  ON bolt_row_failure_diagnostics (failure_code, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_bolt_row_failure_platform_time
  ON bolt_row_failure_diagnostics (platform, occurred_at DESC)
  WHERE platform IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bolt_row_failure_content_type_time
  ON bolt_row_failure_diagnostics (content_type, occurred_at DESC)
  WHERE content_type IS NOT NULL;

ALTER TABLE bolt_row_failure_diagnostics ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE bolt_row_failure_diagnostics IS
  'Per-row diagnostic records for BOLT runs. Additive companion to bolt_failure_summary. See backend/services/boltRowFailureDiagnostics.ts.';

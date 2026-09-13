-- ============================================================================
-- Forward reproducibility migration
--
-- Re-expresses two already-validated, code-required schema changes that are
-- ABSENT from the canonical production snapshot (supabase/_schema/baseline.sql)
-- and would therefore be lost on a fresh reconstruction.
--
-- Origin (historical records — NOT modified, NOT replayed):
--   supabase/migrations/20260814_planner_refinement_lineage.sql
--   supabase/migrations/20260815_bolt_failure_summary.sql
--
-- Both carry 8-digit version names, so the repository's replay rule
-- (scripts/ci/real-schema-ci.sh: `[ "${#ver}" -eq 14 ] || continue`) skips
-- them. They were applied to the local cert database by direct psql, which
-- leaves them unreproducible. This migration carries them forward under a
-- 14-digit version so `baseline.sql` + post-ledger replay reproduces them.
--
-- WHY THESE TWO AND NOTHING ELSE
--   Both are required by executable application code:
--     bolt_failure_summary  — boltFailureDashboard.ts, boltPipelineFailurePersistence.ts,
--                             boltRowFailureDashboard.ts (7 query sites)
--     refinement columns    — campaignPlanStore.ts (optimistic-concurrency update path)
--   No other pending change met that bar; see STEP 3AB.
--
-- DELIBERATELY OMITTED
--   idx_campaign_week_plan_campaign_snapshot — 20260814 creates this index, but
--   baseline.sql ALREADY contains it (CREATE INDEX ... USING btree (campaign_id,
--   snapshot_hash)). Re-expressing it here would be redundant scope, so it is
--   left to the baseline.
--
-- DESIGN FIDELITY
--   The DDL below is a verbatim re-expression of the two historical migrations.
--   Nothing is redesigned, widened, or "improved".
--
-- SAFETY
--   Schema-only. No INSERT/UPDATE/DELETE/TRUNCATE/DROP. No data seeded.
--   Idempotent via IF NOT EXISTS and targeted catalog existence checks.
--   No broad exception handling — a genuine error still aborts the migration.
-- ============================================================================

-- ─── 1. campaign_week_plan refinement lineage (from 20260814) ───────────────
-- Four NULLABLE-tolerant columns supporting optimistic concurrency on async
-- plan refinement. All legacy rows continue to read/write unchanged.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'campaign_week_plan'
      AND column_name = 'refinement_version'
  ) THEN
    ALTER TABLE public.campaign_week_plan
      ADD COLUMN IF NOT EXISTS refinement_version INT NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'campaign_week_plan'
      AND column_name = 'refinement_parent_version'
  ) THEN
    ALTER TABLE public.campaign_week_plan
      ADD COLUMN IF NOT EXISTS refinement_parent_version INT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'campaign_week_plan'
      AND column_name = 'refinement_source'
  ) THEN
    ALTER TABLE public.campaign_week_plan
      ADD COLUMN IF NOT EXISTS refinement_source TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'campaign_week_plan'
      AND column_name = 'refined_at'
  ) THEN
    ALTER TABLE public.campaign_week_plan
      ADD COLUMN IF NOT EXISTS refined_at TIMESTAMPTZ;
  END IF;

  -- refinement_source is constrained to the three sanctioned origins.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_campaign_week_plan_refinement_source'
  ) THEN
    ALTER TABLE public.campaign_week_plan
      ADD CONSTRAINT chk_campaign_week_plan_refinement_source
      CHECK (refinement_source IS NULL OR refinement_source IN ('inline', 'async', 'manual'));
  END IF;
END $$;

COMMENT ON COLUMN public.campaign_week_plan.refinement_version IS
  'Monotonic counter of refinements applied to this plan row. Starts at 0 (base AI-generated plan), bumps to 1 on first refinement, 2 on next, etc. Used for optimistic concurrency by the async refinement worker.';

COMMENT ON COLUMN public.campaign_week_plan.refinement_parent_version IS
  'The refinement_version this refinement was derived from. Forms a linear lineage chain. NULL on the initial base plan.';

COMMENT ON COLUMN public.campaign_week_plan.refinement_source IS
  'Origin of the most-recent refinement: inline (sync orchestrator path), async (BullMQ worker), or manual (operator). NULL on never-refined rows.';

COMMENT ON COLUMN public.campaign_week_plan.refined_at IS
  'Wall-clock timestamp of the most recent refinement. NULL on never-refined rows.';


-- ─── 2. bolt_failure_summary (from 20260815) ────────────────────────────────
-- Operator-facing diagnostic companion to bolt_execution_runs. Additive: the
-- planner never reads this table and no existing read path changes.
CREATE TABLE IF NOT EXISTS public.bolt_failure_summary (
  -- Surrogate so the (run_id, stage) pair can repeat — every catch-site
  -- invocation gets its own row.
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Run + campaign + tenancy. company_id is denormalized so RLS and per-tenant
  -- queries don't have to round-trip through runs.
  run_id                  UUID NOT NULL,
  campaign_id             UUID,
  company_id              UUID,
  strategy_id             TEXT,

  -- Where the failure happened.
  failed_stage            TEXT NOT NULL,
  current_stage           TEXT,

  -- Pipeline + surface tags.
  pipeline_mode           TEXT,
  campaign_type           TEXT,

  -- Raw diagnostic payload.
  raw_error_message       TEXT,
  stack_excerpt           TEXT,
  provider                TEXT,

  -- Normalized classification.
  normalized_error_type   TEXT,
  retriable               BOOLEAN,

  -- Strategy differential captured at failure time.
  strategy_snapshot       JSONB,

  -- Lifecycle.
  is_terminal             BOOLEAN NOT NULL DEFAULT FALSE,
  occurred_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Dashboard indexes ─────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_bolt_failure_summary_run_id
  ON public.bolt_failure_summary (run_id);
CREATE INDEX IF NOT EXISTS idx_bolt_failure_summary_campaign_id
  ON public.bolt_failure_summary (campaign_id)
  WHERE campaign_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bolt_failure_summary_company_id
  ON public.bolt_failure_summary (company_id)
  WHERE company_id IS NOT NULL;

-- Dashboard rollups: by stage, by provider, by type — all recency-ordered.
CREATE INDEX IF NOT EXISTS idx_bolt_failure_summary_stage_time
  ON public.bolt_failure_summary (failed_stage, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_bolt_failure_summary_provider_time
  ON public.bolt_failure_summary (provider, occurred_at DESC)
  WHERE provider IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bolt_failure_summary_type_time
  ON public.bolt_failure_summary (normalized_error_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_bolt_failure_summary_campaign_type_time
  ON public.bolt_failure_summary (campaign_type, occurred_at DESC)
  WHERE campaign_type IS NOT NULL;

-- Terminal-only view of failures — the dashboard's default filter.
CREATE INDEX IF NOT EXISTS idx_bolt_failure_summary_terminal_time
  ON public.bolt_failure_summary (occurred_at DESC)
  WHERE is_terminal = TRUE;

-- ─── RLS ────────────────────────────────────────────────────────────────────
-- Service-role only. Operator/admin diagnostic table; end users never read it
-- directly. Deliberately NO policies: the service role bypasses RLS for writes
-- and the super-admin endpoint authenticates before issuing the read. This
-- matches 20260815 exactly — a zero-policy RLS table is deny-by-default.
ALTER TABLE public.bolt_failure_summary ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.bolt_failure_summary IS
  'Per-failure diagnostic summary for BOLT runs. Additive companion to bolt_execution_runs; planner never reads this table. See backend/services/boltPipelineFailurePersistence.ts.';
COMMENT ON COLUMN public.bolt_failure_summary.is_terminal IS
  'True for the run-final failure row. Dashboards default-filter on this to get one row per failed run.';
COMMENT ON COLUMN public.bolt_failure_summary.strategy_snapshot IS
  'Snapshot of strategy/execution-config fields at failure time. Free-form JSONB; keys documented in captureStrategySnapshot.ts.';

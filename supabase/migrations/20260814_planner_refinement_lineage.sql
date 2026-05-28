-- Planner refinement lineage.
--
-- Adds versioning + source tracking to campaign_week_plan so async refinement
-- can be applied with optimistic-concurrency safety and a forensic record of
-- which refinement was last applied (inline / async / manual).
--
-- Columns:
--   refinement_version        INT      starts at 0, bumps on each refinement
--   refinement_parent_version INT      version this refinement was derived from
--   refinement_source         TEXT     'inline' | 'async' | 'manual'
--   refined_at                TIMESTAMPTZ  wall-clock of last refinement
--
-- Optimistic concurrency: callers update with WHERE refinement_version = N and
-- bump to N+1 atomically. If no row matches, another refinement landed first
-- and the caller should retry or abandon.
--
-- All columns NULLABLE so legacy rows continue to read/write unchanged.
-- Idempotent — DO blocks guard every ADD COLUMN.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'campaign_week_plan'
      AND column_name = 'refinement_version'
  ) THEN
    ALTER TABLE public.campaign_week_plan
      ADD COLUMN refinement_version INT NOT NULL DEFAULT 0;
    RAISE NOTICE 'Added campaign_week_plan.refinement_version';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'campaign_week_plan'
      AND column_name = 'refinement_parent_version'
  ) THEN
    ALTER TABLE public.campaign_week_plan
      ADD COLUMN refinement_parent_version INT;
    RAISE NOTICE 'Added campaign_week_plan.refinement_parent_version';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'campaign_week_plan'
      AND column_name = 'refinement_source'
  ) THEN
    ALTER TABLE public.campaign_week_plan
      ADD COLUMN refinement_source TEXT;
    RAISE NOTICE 'Added campaign_week_plan.refinement_source';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'campaign_week_plan'
      AND column_name = 'refined_at'
  ) THEN
    ALTER TABLE public.campaign_week_plan
      ADD COLUMN refined_at TIMESTAMPTZ;
    RAISE NOTICE 'Added campaign_week_plan.refined_at';
  END IF;

  -- Constraint: refinement_source must be one of the allowed values.
  -- Allowed: inline (synchronous postProcessGeneratedPlan), async
  -- (BullMQ refinement worker), manual (operator override).
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_campaign_week_plan_refinement_source'
  ) THEN
    ALTER TABLE public.campaign_week_plan
      ADD CONSTRAINT chk_campaign_week_plan_refinement_source
      CHECK (refinement_source IS NULL OR refinement_source IN ('inline', 'async', 'manual'));
    RAISE NOTICE 'Added chk_campaign_week_plan_refinement_source';
  END IF;

  -- Index for the (campaign_id, snapshot_hash) lookup path used by the
  -- async refinement processor. Most environments already have this via
  -- the primary key on (id) plus an existing campaign_id index; this is an
  -- explicit compound for the read-by-snapshot-hash pattern.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'campaign_week_plan'
      AND indexname = 'idx_campaign_week_plan_campaign_snapshot'
  ) THEN
    CREATE INDEX idx_campaign_week_plan_campaign_snapshot
      ON public.campaign_week_plan (campaign_id, snapshot_hash);
    RAISE NOTICE 'Added idx_campaign_week_plan_campaign_snapshot';
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

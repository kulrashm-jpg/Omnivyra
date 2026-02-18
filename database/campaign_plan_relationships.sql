-- =====================================================
-- CAMPAIGN PLAN RELATIONSHIPS
-- =====================================================
-- Links 12-week plan → week plans → daily plans with unique IDs and FKs.
--
-- RELATIONSHIP CHAIN:
--   campaigns (id)
--     └── twelve_week_plan (id, campaign_id)          -- 12-week plan with unique id
--           └── weekly_content_refinements (id, campaign_id, twelve_week_plan_id)  -- week plan with unique id
--                 └── daily_content_plans (id, campaign_id, weekly_refinement_id or source_refinement_id)  -- daily plan with unique id
--
-- Run after twelve_week_plan, weekly_content_refinements, daily_content_plans exist.
-- =====================================================

-- VERIFY: Tables and their IDs
-- twelve_week_plan.id   = 12-week plan UUID (already exists)
-- weekly_content_refinements.id = week plan UUID (already exists)
-- daily_content_plans.id = daily plan UUID (already exists)

-- STEP 1: Add twelve_week_plan_id to weekly_content_refinements
-- =====================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'weekly_content_refinements'
      AND column_name = 'twelve_week_plan_id'
  ) THEN
    ALTER TABLE weekly_content_refinements
      ADD COLUMN twelve_week_plan_id UUID REFERENCES twelve_week_plan(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_weekly_refinements_twelve_week_plan
      ON weekly_content_refinements(twelve_week_plan_id);
    RAISE NOTICE 'Added weekly_content_refinements.twelve_week_plan_id';
  END IF;
END $$;

-- STEP 2: Ensure daily_content_plans links to weekly_content_refinements
-- =====================================================
-- Some schemas use source_refinement_id, others weekly_refinement_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'daily_content_plans'
      AND column_name = 'weekly_refinement_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'daily_content_plans'
      AND column_name = 'source_refinement_id'
  ) THEN
    ALTER TABLE daily_content_plans
      ADD COLUMN weekly_refinement_id UUID REFERENCES weekly_content_refinements(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_daily_plans_weekly_refinement
      ON daily_content_plans(weekly_refinement_id);
    RAISE NOTICE 'Added daily_content_plans.weekly_refinement_id';
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'daily_content_plans'
      AND column_name = 'source_refinement_id'
  ) THEN
    -- Ensure FK exists for source_refinement_id
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE constraint_name LIKE '%source_refinement%'
        AND table_name = 'daily_content_plans'
    ) THEN
      ALTER TABLE daily_content_plans
        ADD CONSTRAINT fk_daily_plans_source_refinement
        FOREIGN KEY (source_refinement_id) REFERENCES weekly_content_refinements(id) ON DELETE SET NULL;
    END IF;
  END IF;
END $$;

-- STEP 3: Add week_number to daily_content_plans if missing (for grouping)
-- =====================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'daily_content_plans'
      AND column_name = 'week_number'
  ) THEN
    ALTER TABLE daily_content_plans ADD COLUMN week_number INTEGER;
    CREATE INDEX IF NOT EXISTS idx_daily_plans_week ON daily_content_plans(campaign_id, week_number);
    RAISE NOTICE 'Added daily_content_plans.week_number';
  END IF;
END $$;

-- STEP 4: Verification query (run separately to check links)
-- =====================================================
/*
SELECT 
  'twelve_week_plan' AS table_name,
  id,
  campaign_id,
  NULL::uuid AS parent_id
FROM twelve_week_plan
ORDER BY created_at DESC
LIMIT 1;

SELECT 
  'weekly_content_refinements' AS table_name,
  id,
  campaign_id,
  twelve_week_plan_id AS parent_id,
  week_number
FROM weekly_content_refinements
ORDER BY campaign_id, week_number
LIMIT 5;

SELECT 
  'daily_content_plans' AS table_name,
  d.id,
  d.campaign_id,
  COALESCE(d.weekly_refinement_id, d.source_refinement_id) AS parent_week_id,
  w.twelve_week_plan_id AS parent_12week_id
FROM daily_content_plans d
LEFT JOIN weekly_content_refinements w 
  ON (d.weekly_refinement_id = w.id OR d.source_refinement_id = w.id)
ORDER BY d.campaign_id, d.week_number
LIMIT 5;
*/

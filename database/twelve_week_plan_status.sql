-- Twelve Week Plan: Add status column for unified draft → committed → edited_committed lifecycle
-- Run in Supabase SQL Editor BEFORE using Save for Later / Commit flows. Idempotent.

-- Add status column; default 'committed' for existing rows (backward compatibility)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'twelve_week_plan' AND column_name = 'status'
  ) THEN
    ALTER TABLE twelve_week_plan ADD COLUMN status TEXT NOT NULL DEFAULT 'committed';
    RAISE NOTICE 'Added twelve_week_plan.status';
  END IF;
END $$;

-- Constraint: status must be one of draft, committed, edited_committed
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'twelve_week_plan_status_check'
  ) THEN
    ALTER TABLE twelve_week_plan
    ADD CONSTRAINT twelve_week_plan_status_check
    CHECK (status IN ('draft', 'committed', 'edited_committed'));
    RAISE NOTICE 'Added twelve_week_plan status check constraint';
  END IF;
END $$;

-- Index for status + campaign lookups
CREATE INDEX IF NOT EXISTS idx_twelve_week_plan_campaign_status
  ON twelve_week_plan(campaign_id, status);

COMMENT ON COLUMN twelve_week_plan.status IS 'draft=view/saved, committed=confirmed, edited_committed=post-commit edits';

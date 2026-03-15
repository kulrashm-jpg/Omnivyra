-- Add repurpose lineage columns to scheduled_posts.
-- Purpose: repurpose_index (1/3), repurpose_total (3), repurpose_parent_execution_id (link to original activity).
-- Backward compatibility: repurpose_index = 1, repurpose_total = 1 for existing rows.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'scheduled_posts' AND column_name = 'repurpose_index'
  ) THEN
    ALTER TABLE scheduled_posts ADD COLUMN repurpose_index INTEGER DEFAULT 1;
    RAISE NOTICE 'Added scheduled_posts.repurpose_index';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'scheduled_posts' AND column_name = 'repurpose_total'
  ) THEN
    ALTER TABLE scheduled_posts ADD COLUMN repurpose_total INTEGER DEFAULT 1;
    RAISE NOTICE 'Added scheduled_posts.repurpose_total';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'scheduled_posts' AND column_name = 'repurpose_parent_execution_id'
  ) THEN
    ALTER TABLE scheduled_posts ADD COLUMN repurpose_parent_execution_id TEXT;
    RAISE NOTICE 'Added scheduled_posts.repurpose_parent_execution_id';
  END IF;
END $$;

-- Set defaults for existing rows (nullable columns stay null; defaults apply to new inserts)
UPDATE scheduled_posts SET repurpose_index = 1 WHERE repurpose_index IS NULL;
UPDATE scheduled_posts SET repurpose_total = 1 WHERE repurpose_total IS NULL;

COMMENT ON COLUMN scheduled_posts.repurpose_index IS 'Order of post in repurpose chain (1-based, e.g. 1 for first of 3)';
COMMENT ON COLUMN scheduled_posts.repurpose_total IS 'Total posts in repurpose chain (e.g. 3 for 1/3, 2/3, 3/3)';
COMMENT ON COLUMN scheduled_posts.repurpose_parent_execution_id IS 'Execution ID of original activity this post was repurposed from';

-- Add creator_asset and content_status to daily_content_plans for Creator Activity Workspace.
-- Run in Supabase SQL Editor. Idempotent.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'daily_content_plans' AND column_name = 'creator_asset') THEN
    ALTER TABLE daily_content_plans ADD COLUMN creator_asset JSONB;
    RAISE NOTICE 'Added daily_content_plans.creator_asset';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'daily_content_plans' AND column_name = 'content_status') THEN
    ALTER TABLE daily_content_plans ADD COLUMN content_status TEXT;
    RAISE NOTICE 'Added daily_content_plans.content_status';
  END IF;
END $$;

COMMENT ON COLUMN daily_content_plans.creator_asset IS 'Uploaded creator asset (video, carousel, image) for repurposing: { type, url, files[], thumbnail?, description?, transcript? }';
COMMENT ON COLUMN daily_content_plans.content_status IS 'CREATOR_REQUIRED | READY_FOR_PROMOTION | etc. Used for creator workflow.';

-- Add content-creation fields to daily_content_plans (book-level detail for writing content)
-- Run in Supabase SQL Editor. Idempotent.

-- Content creation fields
ALTER TABLE daily_content_plans ADD COLUMN IF NOT EXISTS topic TEXT;
ALTER TABLE daily_content_plans ADD COLUMN IF NOT EXISTS intro_objective TEXT;
ALTER TABLE daily_content_plans ADD COLUMN IF NOT EXISTS summary TEXT;
ALTER TABLE daily_content_plans ADD COLUMN IF NOT EXISTS objective TEXT;
ALTER TABLE daily_content_plans ADD COLUMN IF NOT EXISTS main_points JSONB;  -- ["point 1", "point 2"]
ALTER TABLE daily_content_plans ADD COLUMN IF NOT EXISTS cta TEXT;
ALTER TABLE daily_content_plans ADD COLUMN IF NOT EXISTS brand_voice TEXT;
ALTER TABLE daily_content_plans ADD COLUMN IF NOT EXISTS format_notes TEXT;
ALTER TABLE daily_content_plans ADD COLUMN IF NOT EXISTS theme_linkage TEXT;  -- how this piece links to week/campaign theme
ALTER TABLE daily_content_plans ADD COLUMN IF NOT EXISTS week_theme TEXT;    -- denormalized week theme
ALTER TABLE daily_content_plans ADD COLUMN IF NOT EXISTS campaign_theme TEXT;  -- denormalized campaign theme

-- key_points exists in generate-weekly-structure; support both
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'daily_content_plans' AND column_name = 'key_points') THEN
    ALTER TABLE daily_content_plans ADD COLUMN key_points JSONB;
  END IF;
END $$;

COMMENT ON COLUMN daily_content_plans.intro_objective IS 'Hook/intro to grab attention; what the first line should achieve';
COMMENT ON COLUMN daily_content_plans.objective IS 'Strategic objective for this piece (e.g. establish authority, drive saves)';
COMMENT ON COLUMN daily_content_plans.main_points IS '2-5 key points or arguments to cover';
COMMENT ON COLUMN daily_content_plans.cta IS 'Call to action for the reader';
COMMENT ON COLUMN daily_content_plans.theme_linkage IS 'How this piece connects to week theme and campaign narrative';

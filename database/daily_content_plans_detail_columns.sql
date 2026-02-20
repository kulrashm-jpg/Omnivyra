-- Optional: Add detail columns to daily_content_plans for "book-level" daily content.
-- Topic, intro objective, summary, objective — per content type.
-- Run in Supabase SQL Editor when ready. Idempotent.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'daily_content_plans' AND column_name = 'topic') THEN
    ALTER TABLE daily_content_plans ADD COLUMN topic TEXT;
    RAISE NOTICE 'Added daily_content_plans.topic';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'daily_content_plans' AND column_name = 'intro_objective') THEN
    ALTER TABLE daily_content_plans ADD COLUMN intro_objective TEXT;
    RAISE NOTICE 'Added daily_content_plans.intro_objective';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'daily_content_plans' AND column_name = 'summary') THEN
    ALTER TABLE daily_content_plans ADD COLUMN summary TEXT;
    RAISE NOTICE 'Added daily_content_plans.summary';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'daily_content_plans' AND column_name = 'objective') THEN
    ALTER TABLE daily_content_plans ADD COLUMN objective TEXT;
    RAISE NOTICE 'Added daily_content_plans.objective';
  END IF;
END $$;

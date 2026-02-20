-- Rich fields for daily_content_plans — enough detail to write content without further questions.
-- Aligns each daily piece with week theme and campaign theme.
-- Run in Supabase SQL Editor. Idempotent.

DO $$
BEGIN
  -- topic: main topic/focus for this piece
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'daily_content_plans' AND column_name = 'topic') THEN
    ALTER TABLE daily_content_plans ADD COLUMN topic TEXT;
    RAISE NOTICE 'Added daily_content_plans.topic';
  END IF;

  -- intro_objective: what the hook/intro should achieve
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'daily_content_plans' AND column_name = 'intro_objective') THEN
    ALTER TABLE daily_content_plans ADD COLUMN intro_objective TEXT;
    RAISE NOTICE 'Added daily_content_plans.intro_objective';
  END IF;

  -- objective: what this piece should achieve (e.g. drive saves, establish authority)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'daily_content_plans' AND column_name = 'objective') THEN
    ALTER TABLE daily_content_plans ADD COLUMN objective TEXT;
    RAISE NOTICE 'Added daily_content_plans.objective';
  END IF;

  -- summary: 1-2 sentence summary (alternate to content for structured brief)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'daily_content_plans' AND column_name = 'summary') THEN
    ALTER TABLE daily_content_plans ADD COLUMN summary TEXT;
    RAISE NOTICE 'Added daily_content_plans.summary';
  END IF;

  -- key_points: 2-5 bullet points / arguments to cover (JSONB array)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'daily_content_plans' AND column_name = 'key_points') THEN
    ALTER TABLE daily_content_plans ADD COLUMN key_points JSONB DEFAULT '[]'::jsonb;
    RAISE NOTICE 'Added daily_content_plans.key_points';
  END IF;

  -- cta: suggested call to action
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'daily_content_plans' AND column_name = 'cta') THEN
    ALTER TABLE daily_content_plans ADD COLUMN cta TEXT;
    RAISE NOTICE 'Added daily_content_plans.cta';
  END IF;

  -- brand_voice: tone (professional, casual, inspirational, etc.)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'daily_content_plans' AND column_name = 'brand_voice') THEN
    ALTER TABLE daily_content_plans ADD COLUMN brand_voice TEXT;
    RAISE NOTICE 'Added daily_content_plans.brand_voice';
  END IF;

  -- theme_linkage: how this piece connects to week theme and campaign theme
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'daily_content_plans' AND column_name = 'theme_linkage') THEN
    ALTER TABLE daily_content_plans ADD COLUMN theme_linkage TEXT;
    RAISE NOTICE 'Added daily_content_plans.theme_linkage';
  END IF;

  -- format_notes: e.g. "5-7 slide carousel", "800 words", "15-30 sec hook"
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'daily_content_plans' AND column_name = 'format_notes') THEN
    ALTER TABLE daily_content_plans ADD COLUMN format_notes TEXT;
    RAISE NOTICE 'Added daily_content_plans.format_notes';
  END IF;
END $$;

COMMENT ON COLUMN daily_content_plans.topic IS 'Main topic/focus for this content piece';
COMMENT ON COLUMN daily_content_plans.intro_objective IS 'What the hook or intro should achieve';
COMMENT ON COLUMN daily_content_plans.objective IS 'What this piece should achieve (e.g. drive saves, establish authority)';
COMMENT ON COLUMN daily_content_plans.summary IS '1-2 sentence structured summary';
COMMENT ON COLUMN daily_content_plans.key_points IS 'JSONB array of 2-5 bullet points to cover';
COMMENT ON COLUMN daily_content_plans.cta IS 'Suggested call to action';
COMMENT ON COLUMN daily_content_plans.brand_voice IS 'Tone: professional, casual, inspirational, etc.';
COMMENT ON COLUMN daily_content_plans.theme_linkage IS 'How this piece connects to week theme and campaign theme';
COMMENT ON COLUMN daily_content_plans.format_notes IS 'e.g. 5-7 slide carousel, 800 words, 15-30 sec hook';

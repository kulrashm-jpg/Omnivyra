-- Seven Days Plan — detailed 7-day blueprint per week (mirrors twelve_week_plan structure)
-- One row per (campaign_id, week_number). days JSONB holds Mon–Sun with "book-level" detail.
-- Run in Supabase SQL Editor. Idempotent.

-- Parent linkage: campaign + week (links to twelve_week_plan via campaign_id + week_number)
CREATE TABLE IF NOT EXISTS seven_days_plan (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  week_number INTEGER NOT NULL CHECK (week_number >= 1 AND week_number <= 52),

  -- Week context (denormalized for display; source of truth is twelve_week_plan)
  week_theme TEXT,
  week_phase_label TEXT,
  week_topics TEXT[],  -- topics_to_cover from parent week

  -- 7-day blueprint: [ Monday, Tuesday, ..., Sunday ]
  -- Each day: intro_objective, key_message, supporting_points, platforms[], content_items[], etc.
  days JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Metadata
  source TEXT NOT NULL DEFAULT 'ai',  -- ai, manual, chat_edit
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'questions_pending', 'committed', 'edited')),
  snapshot_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (campaign_id, week_number)
);

CREATE INDEX IF NOT EXISTS idx_seven_days_plan_campaign
  ON seven_days_plan(campaign_id);
CREATE INDEX IF NOT EXISTS idx_seven_days_plan_week
  ON seven_days_plan(campaign_id, week_number);

COMMENT ON TABLE seven_days_plan IS '7-day detailed blueprints per week; question-driven, book-level detail for content creation';
COMMENT ON COLUMN seven_days_plan.days IS 'Array of 7 day objects. Each: day, intro_objective, key_message, supporting_points, platform_content[], cta, best_posting_time, content_format_notes, topic_linkage';

-- days JSONB structure (documentation):
-- [
--   {
--     "day": "Monday",
--     "intro_objective": "Hook readers with...",
--     "key_message": "Understanding mental clarity and its importance",
--     "supporting_points": ["Point 1", "Point 2"],
--     "cta": "Follow for daily tips",
--     "brand_voice": "professional",
--     "best_posting_time": "09:00",
--     "content_format_notes": "Carousel-friendly, 5-7 slides",
--     "topic_linkage": "Main theme Path to Mental Clarity - Week 2 conversion phase",
--     "platform_content": [
--       {
--         "platform": "linkedin",
--         "content_type": "Educational Post",
--         "title": "...",
--         "description": "...",
--         "references": []
--       }
--     ]
--   },
--   ...
-- ]

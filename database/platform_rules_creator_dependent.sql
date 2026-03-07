-- Add creator_dependent column to platform_rules for filtering content types in capacity/question flows.
-- creator_dependent = true: Video, Reel, Short, Carousel, etc. (requires human creation).
-- creator_dependent = false: Post, Blog, Article, Story, Thread (AI-automated).
-- Run after: platform-rules.sql
-- =====================================================

ALTER TABLE platform_rules
  ADD COLUMN IF NOT EXISTS creator_dependent BOOLEAN DEFAULT NULL;

COMMENT ON COLUMN platform_rules.creator_dependent IS 'When true, content type requires human/creator input. When false, can be AI-automated. NULL = use execution mode inference.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Add likes_count to blogs table
--
-- REQUIRED: performanceEngine.computeEngagementScore() weights likes_count at
-- 35 points (35% of total score). The blogs table was missing this column,
-- making engagement scoring structurally broken for Company Admin.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE blogs
  ADD COLUMN IF NOT EXISTS likes_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS blogs_likes_count_company_idx
  ON blogs (company_id)
  WHERE likes_count > 0;

COMMENT ON COLUMN blogs.likes_count IS
  'Required by performanceEngine.computeEngagementScore() — 35pt weight (35% of total score). '
  'Incremented by the blog like action on the company blog frontend.';

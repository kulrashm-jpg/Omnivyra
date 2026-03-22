-- Add angle_type to blogs table
-- Tracks which editorial angle was used when AI-generating a blog post.
-- Used for angle performance analytics (analytical vs contrarian vs strategic).

ALTER TABLE blogs
  ADD COLUMN IF NOT EXISTS angle_type TEXT
    CHECK (angle_type IN ('analytical', 'contrarian', 'strategic'));

-- Index for efficient angle-performance grouping
CREATE INDEX IF NOT EXISTS blogs_angle_type_company_idx
  ON blogs (company_id, angle_type)
  WHERE angle_type IS NOT NULL;

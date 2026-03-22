-- Add hook_strength to blogs so AI-assessed hook quality is persisted
-- and can be correlated with real scroll-depth analytics.

ALTER TABLE blogs
  ADD COLUMN IF NOT EXISTS hook_strength TEXT
    CHECK (hook_strength IN ('strong', 'moderate', 'weak'));

CREATE INDEX IF NOT EXISTS blogs_hook_strength_company_idx
  ON blogs (company_id, hook_strength)
  WHERE hook_strength IS NOT NULL;

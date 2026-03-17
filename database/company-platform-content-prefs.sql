-- Add platform content type preferences to company profiles.
-- Stores per-platform configured content types: Record<string, string[]>
-- e.g. { "linkedin": ["post", "article"], "instagram": ["reel", "story"] }

ALTER TABLE company_profiles
  ADD COLUMN IF NOT EXISTS platform_content_type_prefs JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN company_profiles.platform_content_type_prefs IS
  'User-configured content types per social platform. Keys = platform names; values = string[] of selected content types. Empty object = use system defaults.';

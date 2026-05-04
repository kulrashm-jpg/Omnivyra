-- ─────────────────────────────────────────────────────────────────────────────
-- Company Blog Pillar Topics
--
-- Per-company pillar topics for content gap detection.
-- Replaces the hardcoded PILLAR_TOPICS array in topicDetection.ts for
-- Company Admin use.
--
-- If a company has no rows here:
--   - detectContentGaps() receives an empty array
--   - returns [] with no gaps — not wrong data
--   - the API communicates this state to the client as pillars_configured: false
--
-- The platform Super Admin blog continues to use PLATFORM_DEFAULT_PILLARS
-- (the renamed constant in topicDetection.ts) — no rows needed here for SA.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS company_blog_pillars (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID    NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  slug        TEXT    NOT NULL,
  priority    INTEGER NOT NULL DEFAULT 0,  -- lower number = higher priority
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (company_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_company_blog_pillars_company
  ON company_blog_pillars(company_id, priority ASC);

ALTER TABLE company_blog_pillars ENABLE ROW LEVEL SECURITY;
-- Service role full access. API enforces company membership.

COMMENT ON TABLE company_blog_pillars IS
  'Per-company pillar topics for content gap detection. '
  'If empty for a company, the intelligence API returns pillars_configured: false. '
  'detectContentGaps() is NOT called with fallback defaults.';

COMMENT ON COLUMN company_blog_pillars.priority IS
  'Display + prioritisation order. Lower = higher priority. 0 = top priority.';

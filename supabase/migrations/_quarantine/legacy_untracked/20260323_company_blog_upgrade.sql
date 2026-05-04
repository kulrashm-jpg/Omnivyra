-- ============================================================
-- Company Blog Upgrade
-- Creates blogs table (if not yet applied) and extends it
-- to support full content + campaign integration.
-- Fully idempotent — safe to re-run after partial failure.
-- ============================================================

-- ── 1. Create blogs table (base schema from database/blogs.sql) ───────────────
--       CREATE TABLE IF NOT EXISTS is safe whether the table exists or not.

CREATE TABLE IF NOT EXISTS blogs (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_by     UUID        NOT NULL,
  title          TEXT        NOT NULL DEFAULT 'Untitled',
  content        TEXT        NOT NULL DEFAULT '',
  status         TEXT        NOT NULL DEFAULT 'draft'
                             CHECK (status IN ('draft', 'published', 'failed')),
  integration_id UUID        REFERENCES company_integrations(id) ON DELETE SET NULL,
  external_id    TEXT,
  published_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS blogs_company_id_idx ON blogs(company_id);
CREATE INDEX IF NOT EXISTS blogs_status_idx     ON blogs(company_id, status);
CREATE INDEX IF NOT EXISTS blogs_created_at_idx ON blogs(created_at DESC);

-- ── 2. Extend blogs table with new columns ────────────────────────────────────

ALTER TABLE blogs ADD COLUMN IF NOT EXISTS slug                 TEXT;
ALTER TABLE blogs ADD COLUMN IF NOT EXISTS excerpt              TEXT;
ALTER TABLE blogs ADD COLUMN IF NOT EXISTS content_blocks       JSONB;
ALTER TABLE blogs ADD COLUMN IF NOT EXISTS featured_image_url   TEXT;
ALTER TABLE blogs ADD COLUMN IF NOT EXISTS category             TEXT;
ALTER TABLE blogs ADD COLUMN IF NOT EXISTS tags                 TEXT[]  DEFAULT '{}';
ALTER TABLE blogs ADD COLUMN IF NOT EXISTS seo_meta_title       TEXT;
ALTER TABLE blogs ADD COLUMN IF NOT EXISTS seo_meta_description TEXT;
ALTER TABLE blogs ADD COLUMN IF NOT EXISTS is_featured          BOOLEAN DEFAULT false;
ALTER TABLE blogs ADD COLUMN IF NOT EXISTS views_count          INTEGER DEFAULT 0;

-- Update status CHECK to include 'scheduled'
-- Drop old constraint by name, re-add with new allowed values.
-- Safe to run even if the constraint doesn't exist (DROP CONSTRAINT IF EXISTS).
ALTER TABLE blogs DROP CONSTRAINT IF EXISTS blogs_status_check;
ALTER TABLE blogs ADD CONSTRAINT blogs_status_check
  CHECK (status IN ('draft', 'scheduled', 'published', 'failed'));

-- ── 3. Unique index: slug per company ─────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS idx_blogs_company_slug
  ON blogs(company_id, slug)
  WHERE slug IS NOT NULL;

-- ── 4. Campaign table: blog source type discriminator ─────────────────────────

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS source_blog_type TEXT DEFAULT 'public'
    CHECK (source_blog_type IN ('public', 'company'));

-- ── 5. Campaign performance: suggested blog type discriminator ────────────────

ALTER TABLE campaign_performance
  ADD COLUMN IF NOT EXISTS suggested_blog_type TEXT DEFAULT 'public'
    CHECK (suggested_blog_type IN ('public', 'company'));

-- Blog Intelligence System
-- Topics, Knowledge Graph, Reading Series

-- ── Series ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS blog_series (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  description TEXT,
  cover_url   TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS blog_series_posts (
  series_id UUID    NOT NULL REFERENCES blog_series(id) ON DELETE CASCADE,
  blog_id   UUID    NOT NULL REFERENCES public_blogs(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (series_id, blog_id)
);

CREATE INDEX IF NOT EXISTS idx_blog_series_posts_series ON blog_series_posts(series_id, position);
CREATE INDEX IF NOT EXISTS idx_blog_series_posts_blog   ON blog_series_posts(blog_id);

-- ── Knowledge Graph ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS blog_relationships (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_blog_id    UUID NOT NULL REFERENCES public_blogs(id) ON DELETE CASCADE,
  target_blog_id    UUID NOT NULL REFERENCES public_blogs(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL DEFAULT 'related'
                    CHECK (relationship_type IN ('related','prerequisite','continuation')),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (source_blog_id, target_blog_id, relationship_type)
);

CREATE INDEX IF NOT EXISTS idx_blog_relationships_source ON blog_relationships(source_blog_id);
CREATE INDEX IF NOT EXISTS idx_blog_relationships_target ON blog_relationships(target_blog_id);

-- ── RLS (public_blogs already has RLS — series/relationships are admin-only) ──

ALTER TABLE blog_series           ENABLE ROW LEVEL SECURITY;
ALTER TABLE blog_series_posts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE blog_relationships    ENABLE ROW LEVEL SECURITY;

-- Allow public SELECT for series (needed for public blog page series widget)
CREATE POLICY "public can read series"
  ON blog_series FOR SELECT USING (true);

CREATE POLICY "public can read series posts"
  ON blog_series_posts FOR SELECT USING (true);

CREATE POLICY "public can read relationships"
  ON blog_relationships FOR SELECT USING (true);

-- Service role has full access (admin API uses service key)

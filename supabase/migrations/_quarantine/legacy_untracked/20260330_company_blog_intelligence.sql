-- ─────────────────────────────────────────────────────────────────────────────
-- Company Blog Intelligence: Series + Knowledge Graph
--
-- Does NOT extend blog_series / blog_relationships.
-- Those tables have FK constraints to public_blogs(id) — modifying them to
-- support a polymorphic blog_id would destroy referential integrity.
--
-- Instead, parallel tables scoped to company_id + FK → blogs(id).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Company Blog Series ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS company_blog_series (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID    NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title       TEXT    NOT NULL,
  slug        TEXT    NOT NULL,
  description TEXT,
  cover_url   TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (company_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_company_blog_series_company
  ON company_blog_series(company_id);

-- ── Company Blog Series Posts ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS company_blog_series_posts (
  series_id UUID    NOT NULL REFERENCES company_blog_series(id) ON DELETE CASCADE,
  blog_id   UUID    NOT NULL REFERENCES blogs(id)               ON DELETE CASCADE,
  position  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (series_id, blog_id)
);

CREATE INDEX IF NOT EXISTS idx_company_blog_series_posts_series
  ON company_blog_series_posts(series_id, position);

CREATE INDEX IF NOT EXISTS idx_company_blog_series_posts_blog
  ON company_blog_series_posts(blog_id);

-- ── Company Blog Relationships (Knowledge Graph) ───────────────────────────────

CREATE TABLE IF NOT EXISTS company_blog_relationships (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source_blog_id    UUID NOT NULL REFERENCES blogs(id)     ON DELETE CASCADE,
  target_blog_id    UUID NOT NULL REFERENCES blogs(id)     ON DELETE CASCADE,
  relationship_type TEXT NOT NULL DEFAULT 'related'
                    CHECK (relationship_type IN ('related', 'prerequisite', 'continuation')),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_company_blog_rel_different CHECK (source_blog_id <> target_blog_id),
  UNIQUE (source_blog_id, target_blog_id, relationship_type)
);

CREATE INDEX IF NOT EXISTS idx_company_blog_rel_company
  ON company_blog_relationships(company_id);

CREATE INDEX IF NOT EXISTS idx_company_blog_rel_source
  ON company_blog_relationships(source_blog_id);

CREATE INDEX IF NOT EXISTS idx_company_blog_rel_target
  ON company_blog_relationships(target_blog_id);

-- ── RLS ────────────────────────────────────────────────────────────────────────
-- Service role has full access.
-- API layer enforces company membership via enforceCompanyAccess().

ALTER TABLE company_blog_series           ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_blog_series_posts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_blog_relationships    ENABLE ROW LEVEL SECURITY;

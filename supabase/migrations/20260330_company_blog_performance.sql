-- ─────────────────────────────────────────────────────────────────────────────
-- Company Blog Performance Tracking
--
-- Mirrors blog_performance.sql / blog_read_sessions for the public_blogs table,
-- but scoped to the company blogs table with company_id included.
--
-- blog_read_sessions FK → public_blogs(id) — cannot be reused for company blogs.
-- company_blog_performance_summary view includes company_id so the intelligence
-- API can filter by company without an extra join.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Company blog read sessions ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS company_blog_read_sessions (
  id           UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  blog_id      UUID    NOT NULL REFERENCES blogs(id)     ON DELETE CASCADE,
  company_id   UUID    NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  session_key  TEXT    NOT NULL,
  time_seconds INTEGER NOT NULL DEFAULT 0,
  scroll_depth INTEGER NOT NULL DEFAULT 0,   -- max scroll % reached (0–100)
  completed    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- One row per session per blog (session_key is browser-generated UUID)
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_blog_sessions_key
  ON company_blog_read_sessions(session_key);

CREATE INDEX IF NOT EXISTS idx_company_blog_sessions_blog
  ON company_blog_read_sessions(blog_id);

CREATE INDEX IF NOT EXISTS idx_company_blog_sessions_company
  ON company_blog_read_sessions(company_id);

-- ── Aggregated performance view ────────────────────────────────────────────────
-- Mirrors blog_performance_summary but includes company_id for direct filtering.

CREATE OR REPLACE VIEW company_blog_performance_summary AS
SELECT
  blog_id,
  company_id,
  COUNT(*)                                                       AS session_count,
  ROUND(AVG(time_seconds))                                       AS avg_time_seconds,
  ROUND(AVG(scroll_depth))                                       AS avg_scroll_depth,
  ROUND(AVG(CASE WHEN completed THEN 100.0 ELSE 0.0 END))       AS completion_rate,
  COUNT(*) FILTER (WHERE completed)                              AS completed_count,
  MAX(updated_at)                                                AS last_session_at
FROM company_blog_read_sessions
GROUP BY blog_id, company_id;

-- ── RLS ────────────────────────────────────────────────────────────────────────

ALTER TABLE company_blog_read_sessions ENABLE ROW LEVEL SECURITY;

-- Tracker runs on company-hosted pages — unauthenticated inserts allowed
CREATE POLICY "anyone can insert company blog session"
  ON company_blog_read_sessions FOR INSERT WITH CHECK (true);

-- Session updates (time/scroll progress) allowed by session_key match at app layer
CREATE POLICY "anyone can update company blog session"
  ON company_blog_read_sessions FOR UPDATE USING (true);

-- SELECT: service role only (intelligence API uses service key)

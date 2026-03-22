-- Blog Performance Tracking
-- Stores per-session read data. Aggregated into a view for fast queries.

-- ── Read sessions ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS blog_read_sessions (
  id           UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  blog_id      UUID    NOT NULL REFERENCES public_blogs(id) ON DELETE CASCADE,
  session_key  TEXT    NOT NULL,       -- random UUID per browser session (not user-linked)
  time_seconds INTEGER NOT NULL DEFAULT 0,
  scroll_depth INTEGER NOT NULL DEFAULT 0,   -- max scroll % reached (0–100)
  completed    BOOLEAN NOT NULL DEFAULT FALSE, -- reached the article bottom
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- One row per session per blog
CREATE UNIQUE INDEX IF NOT EXISTS idx_blog_read_sessions_key ON blog_read_sessions(session_key);
CREATE INDEX        IF NOT EXISTS idx_blog_read_sessions_blog ON blog_read_sessions(blog_id);

-- ── Aggregated performance view ───────────────────────────────────────────────

CREATE OR REPLACE VIEW blog_performance_summary AS
SELECT
  blog_id,
  COUNT(*)                                                         AS session_count,
  ROUND(AVG(time_seconds))                                         AS avg_time_seconds,
  ROUND(AVG(scroll_depth))                                         AS avg_scroll_depth,
  ROUND(AVG(CASE WHEN completed THEN 100.0 ELSE 0.0 END))         AS completion_rate,
  COUNT(*) FILTER (WHERE completed)                                AS completed_count,
  MAX(updated_at)                                                  AS last_session_at
FROM blog_read_sessions
GROUP BY blog_id;

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE blog_read_sessions ENABLE ROW LEVEL SECURITY;

-- Anyone can INSERT (anonymous tracking — no auth required)
CREATE POLICY "anyone can track read sessions"
  ON blog_read_sessions FOR INSERT WITH CHECK (true);

-- Anyone can UPDATE their own session (by session_key match via application logic)
CREATE POLICY "anyone can update read sessions"
  ON blog_read_sessions FOR UPDATE USING (true);

-- Only service role can SELECT (admin API uses service key, anon cannot enumerate sessions)

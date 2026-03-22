-- v2 additions to blog_analytics and new pre-aggregated daily table

-- 1. Add session_id column to blog_analytics
ALTER TABLE blog_analytics ADD COLUMN IF NOT EXISTS session_id TEXT;

CREATE INDEX IF NOT EXISTS blog_analytics_session_idx ON blog_analytics(session_id);

-- 2. Pre-aggregated daily rollup table (for scalable dashboard queries)
CREATE TABLE IF NOT EXISTS blog_analytics_daily (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  TEXT    NOT NULL,
  url_slug    TEXT    NOT NULL,
  date        DATE    NOT NULL,
  views       INTEGER NOT NULL DEFAULT 0,
  sessions    INTEGER NOT NULL DEFAULT 0,
  avg_time    NUMERIC(8,2) NOT NULL DEFAULT 0,
  avg_scroll  NUMERIC(5,2) NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, url_slug, date)
);

CREATE INDEX IF NOT EXISTS blog_analytics_daily_account_idx  ON blog_analytics_daily(account_id, date DESC);
CREATE INDEX IF NOT EXISTS blog_analytics_daily_slug_idx     ON blog_analytics_daily(account_id, url_slug, date DESC);

ALTER TABLE blog_analytics_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_all_daily" ON blog_analytics_daily USING (true) WITH CHECK (true);

-- 3. Allow subdomains flag in blog_intelligence_settings
ALTER TABLE blog_intelligence_settings ADD COLUMN IF NOT EXISTS allow_subdomains BOOLEAN NOT NULL DEFAULT FALSE;

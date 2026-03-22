-- Stores per-company Blog Intelligence configuration
-- allowed_domain: used for origin validation in /api/track

CREATE TABLE IF NOT EXISTS blog_intelligence_settings (
  company_id     TEXT        PRIMARY KEY,
  allowed_domain TEXT,       -- e.g. 'myblog.com' — set during wizard setup
  enabled        BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE blog_intelligence_settings ENABLE ROW LEVEL SECURITY;

-- Service-role only (reads happen server-side in /api/track)
CREATE POLICY "service_all" ON blog_intelligence_settings
  USING (true) WITH CHECK (true);

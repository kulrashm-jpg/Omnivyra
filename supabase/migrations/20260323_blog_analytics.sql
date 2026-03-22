-- blog_analytics: stores raw tracking events from embedded tracker.js
-- account_id = company_id (UUID) auto-injected into the tracker script

CREATE TABLE IF NOT EXISTS blog_analytics (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    TEXT        NOT NULL,
  url_slug      TEXT        NOT NULL,
  event_type    TEXT        NOT NULL DEFAULT 'pageview',
  time_on_page  INTEGER     NOT NULL DEFAULT 0,   -- seconds on page at event time
  scroll_depth  INTEGER     NOT NULL DEFAULT 0,   -- max scroll % (0–100)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS blog_analytics_account_id_idx  ON blog_analytics(account_id);
CREATE INDEX IF NOT EXISTS blog_analytics_url_slug_idx    ON blog_analytics(account_id, url_slug);
CREATE INDEX IF NOT EXISTS blog_analytics_created_at_idx  ON blog_analytics(created_at DESC);

-- RLS: allow unauthenticated inserts (tracker runs on external sites)
ALTER TABLE blog_analytics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tracker_insert" ON blog_analytics
  FOR INSERT WITH CHECK (true);

CREATE POLICY "owner_select" ON blog_analytics
  FOR SELECT USING (true);  -- service-role client used server-side

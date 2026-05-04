-- Intent signals additions to blog_analytics (tracker v4)

ALTER TABLE blog_analytics ADD COLUMN IF NOT EXISTS referrer_source TEXT;
ALTER TABLE blog_analytics ADD COLUMN IF NOT EXISTS intent_meta     JSONB;

-- Index for referrer analysis and intent signal queries
CREATE INDEX IF NOT EXISTS blog_analytics_referrer_idx    ON blog_analytics(account_id, referrer_source);
CREATE INDEX IF NOT EXISTS blog_analytics_intent_type_idx ON blog_analytics(account_id, event_type)
  WHERE event_type IN ('cta_click', 'link_click', 'copy', 'form_interaction');

-- =====================================================
-- INTELLIGENCE SYSTEM ACTIVATION
-- Minimal configuration to activate the pipeline
-- =====================================================
-- Prerequisites: companies, external_api_sources, company_api_configs tables
-- Run: psql or Supabase SQL editor
-- =====================================================

-- 1. Insert external API sources (skip if name exists)
INSERT INTO external_api_sources (name, base_url, purpose, is_active, category)
SELECT v.name, v.base_url, v.purpose, v.is_active, v.category
FROM (VALUES
  ('google_trends', 'https://trends.google.com/trending/rss', 'trends', true, 'trend'),
  ('reddit_trends', 'https://www.reddit.com/r/trending.json', 'trends', true, 'trend'),
  ('news_trends', 'https://newsapi.org/v2/top-headlines', 'trends', true, 'trend')
) AS v(name, base_url, purpose, is_active, category)
WHERE NOT EXISTS (SELECT 1 FROM external_api_sources e WHERE e.name = v.name);

-- 2. Link first company to all active API sources (company_api_configs)
INSERT INTO company_api_configs (company_id, api_source_id, enabled, polling_frequency)
SELECT c.id, s.id, true, '2h'
FROM companies c
CROSS JOIN external_api_sources s
WHERE s.is_active = true
ON CONFLICT (company_id, api_source_id) DO UPDATE SET enabled = true, updated_at = now();

-- 3. Ensure at least one company has Phase-3 config (for distribution targeting)
INSERT INTO company_intelligence_topics (company_id, topic, enabled)
SELECT c.id, 'marketing', true
FROM (SELECT id FROM companies ORDER BY created_at LIMIT 1) c
WHERE NOT EXISTS (
  SELECT 1 FROM company_intelligence_topics t
  WHERE t.company_id = c.id AND t.topic = 'marketing'
);

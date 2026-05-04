-- =====================================================
-- INTELLIGENCE SIGNAL ENTITY TABLES (relational)
-- Structured intelligence: topics, companies, keywords, influencers
-- Cascade delete when parent signal is removed (e.g. by retention cleanup)
-- =====================================================
-- Run after: intelligence_signals.sql
-- =====================================================

-- signal_topics: topic values extracted from or related to a signal
CREATE TABLE IF NOT EXISTS signal_topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id UUID NOT NULL REFERENCES intelligence_signals(id) ON DELETE CASCADE,
  value TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS index_signal_topics_value ON signal_topics (value);
CREATE INDEX IF NOT EXISTS index_signal_topics_signal_id ON signal_topics (signal_id);

-- signal_companies: company names or IDs referenced in a signal
CREATE TABLE IF NOT EXISTS signal_companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id UUID NOT NULL REFERENCES intelligence_signals(id) ON DELETE CASCADE,
  value TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS index_signal_companies_value ON signal_companies (value);
CREATE INDEX IF NOT EXISTS index_signal_companies_signal_id ON signal_companies (signal_id);

-- signal_keywords: keywords or tags associated with a signal
CREATE TABLE IF NOT EXISTS signal_keywords (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id UUID NOT NULL REFERENCES intelligence_signals(id) ON DELETE CASCADE,
  value TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS index_signal_keywords_value ON signal_keywords (value);
CREATE INDEX IF NOT EXISTS index_signal_keywords_signal_id ON signal_keywords (signal_id);

-- signal_influencers: influencer or author references in a signal
CREATE TABLE IF NOT EXISTS signal_influencers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id UUID NOT NULL REFERENCES intelligence_signals(id) ON DELETE CASCADE,
  value TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS index_signal_influencers_value ON signal_influencers (value);
CREATE INDEX IF NOT EXISTS index_signal_influencers_signal_id ON signal_influencers (signal_id);

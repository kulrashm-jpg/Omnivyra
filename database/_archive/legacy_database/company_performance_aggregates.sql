-- Company Performance Aggregates (Campaign Learning Layer)
-- Pre-aggregated theme/platform/content-type performance. Populated by performanceAggregationJob.
-- Run in Supabase SQL Editor. Idempotent.

CREATE TABLE IF NOT EXISTS company_theme_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  theme TEXT NOT NULL,
  signal_count INTEGER DEFAULT 0,
  avg_engagement DECIMAL(12,2) DEFAULT 0,
  avg_impressions DECIMAL(12,2) DEFAULT 0,
  score DECIMAL(10,4) DEFAULT 0,
  computed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (company_id, theme)
);

CREATE TABLE IF NOT EXISTS company_platform_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  signal_count INTEGER DEFAULT 0,
  avg_engagement DECIMAL(12,2) DEFAULT 0,
  avg_impressions DECIMAL(12,2) DEFAULT 0,
  score DECIMAL(10,4) DEFAULT 0,
  computed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (company_id, platform)
);

CREATE TABLE IF NOT EXISTS company_content_type_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  content_type TEXT NOT NULL,
  signal_count INTEGER DEFAULT 0,
  avg_engagement DECIMAL(12,2) DEFAULT 0,
  avg_impressions DECIMAL(12,2) DEFAULT 0,
  score DECIMAL(10,4) DEFAULT 0,
  computed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (company_id, content_type)
);

CREATE INDEX IF NOT EXISTS idx_company_theme_performance_company ON company_theme_performance(company_id);
CREATE INDEX IF NOT EXISTS idx_company_platform_performance_company ON company_platform_performance(company_id);
CREATE INDEX IF NOT EXISTS idx_company_content_type_performance_company ON company_content_type_performance(company_id);

-- Super-admin managed source/community catalog for Active Leads discovery.
-- Entries here are matched to company industries and surfaced to company
-- admins as curated "Find Sources" recommendations.

CREATE TABLE IF NOT EXISTS public.curated_industry_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_identifier TEXT NOT NULL,
  source_url TEXT NULL,
  platform TEXT NULL,
  integration_mode TEXT NOT NULL DEFAULT 'public_login',
  industry_tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  similar_industry_tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  opportunity_types TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  recommendation_reason TEXT NULL,
  estimated_signal_quality NUMERIC NOT NULL DEFAULT 0.65,
  estimated_volume INTEGER NOT NULL DEFAULT 120,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT curated_industry_sources_unique_source UNIQUE (source_type, source_identifier),
  CONSTRAINT curated_industry_sources_integration_mode_check
    CHECK (integration_mode IN ('public', 'public_login', 'oauth', 'api_key', 'manual')),
  CONSTRAINT curated_industry_sources_signal_quality_check
    CHECK (estimated_signal_quality BETWEEN 0 AND 1),
  CONSTRAINT curated_industry_sources_volume_check
    CHECK (estimated_volume >= 0)
);

CREATE INDEX IF NOT EXISTS idx_curated_industry_sources_active
  ON public.curated_industry_sources (is_active, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_curated_industry_sources_industry_tags
  ON public.curated_industry_sources USING GIN (industry_tags);

CREATE INDEX IF NOT EXISTS idx_curated_industry_sources_similar_industry_tags
  ON public.curated_industry_sources USING GIN (similar_industry_tags);

CREATE OR REPLACE FUNCTION public.trg_curated_industry_sources_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS curated_industry_sources_set_updated_at ON public.curated_industry_sources;
CREATE TRIGGER curated_industry_sources_set_updated_at
  BEFORE UPDATE ON public.curated_industry_sources
  FOR EACH ROW EXECUTE FUNCTION public.trg_curated_industry_sources_updated_at();

INSERT INTO public.curated_industry_sources (
  source_name,
  source_type,
  source_identifier,
  source_url,
  platform,
  integration_mode,
  industry_tags,
  similar_industry_tags,
  opportunity_types,
  recommendation_reason,
  estimated_signal_quality,
  estimated_volume,
  is_active
) VALUES (
  'Hacker News',
  'hackernews',
  'hackernews:frontpage',
  'https://news.ycombinator.com',
  'hackernews',
  'public_login',
  ARRAY['technology', 'software', 'saas', 'developer tools', 'ai', 'startup'],
  ARRAY['fintech', 'cybersecurity', 'data infrastructure', 'cloud', 'b2b'],
  ARRAY['buying_intent', 'product_research', 'integration_need', 'competitor_dissatisfaction'],
  'Curated for technology and software companies because founders, engineers, and early adopters discuss product needs, tools, launches, and migration pain here.',
  0.72,
  180,
  TRUE
) ON CONFLICT (source_type, source_identifier) DO NOTHING;

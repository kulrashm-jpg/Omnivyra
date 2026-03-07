-- =====================================================
-- CAMPAIGN OPPORTUNITIES
-- Campaign opportunities derived from strategic themes
-- Used by Campaign Builder, Content Planning, Marketing Teams
-- =====================================================
-- Run after: strategic_themes.sql
-- =====================================================

CREATE TABLE IF NOT EXISTS campaign_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  theme_id UUID NOT NULL REFERENCES strategic_themes(id) ON DELETE CASCADE,
  cluster_id UUID NOT NULL REFERENCES signal_clusters(cluster_id) ON DELETE CASCADE,
  opportunity_title TEXT NOT NULL,
  opportunity_description TEXT NOT NULL,
  opportunity_type TEXT NOT NULL,
  momentum_score NUMERIC,
  keywords JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT campaign_opportunities_theme_type_unique UNIQUE (theme_id, opportunity_type),
  CONSTRAINT campaign_opportunities_type_check CHECK (
    opportunity_type IN (
      'content_marketing',
      'thought_leadership',
      'product_positioning',
      'industry_education'
    )
  )
);

CREATE INDEX IF NOT EXISTS index_campaign_opportunities_theme
  ON campaign_opportunities (theme_id);

CREATE INDEX IF NOT EXISTS index_campaign_opportunities_cluster
  ON campaign_opportunities (cluster_id);

CREATE INDEX IF NOT EXISTS index_campaign_opportunities_type
  ON campaign_opportunities (opportunity_type);

CREATE INDEX IF NOT EXISTS index_campaign_opportunities_momentum
  ON campaign_opportunities (momentum_score DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS index_campaign_opportunities_created_at
  ON campaign_opportunities (created_at DESC);

-- =====================================================
-- STRATEGIC THEMES
-- Marketing themes derived from signal intelligence
-- =====================================================
-- Run after: signal_intelligence.sql
-- =====================================================

CREATE TABLE IF NOT EXISTS strategic_themes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id UUID NOT NULL REFERENCES signal_clusters(cluster_id) ON DELETE CASCADE,
  intelligence_id UUID NOT NULL REFERENCES signal_intelligence(id) ON DELETE CASCADE,
  theme_title TEXT NOT NULL,
  theme_description TEXT NOT NULL,
  momentum_score NUMERIC,
  trend_direction TEXT,
  companies JSONB DEFAULT '[]'::jsonb,
  keywords JSONB DEFAULT '[]'::jsonb,
  influencers JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT strategic_themes_cluster_unique UNIQUE (cluster_id)
);

CREATE INDEX IF NOT EXISTS index_strategic_themes_cluster
  ON strategic_themes (cluster_id);

CREATE INDEX IF NOT EXISTS index_strategic_themes_intelligence
  ON strategic_themes (intelligence_id);

CREATE INDEX IF NOT EXISTS index_strategic_themes_momentum
  ON strategic_themes (momentum_score DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS index_strategic_themes_created_at
  ON strategic_themes (created_at DESC);

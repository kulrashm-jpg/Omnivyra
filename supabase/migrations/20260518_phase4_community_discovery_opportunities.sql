-- Phase 4 — Community discovery, intent clusters, opportunity feed.
-- Additive only. Three new tables, no edits to existing tables.
-- Nothing here starts a worker, schedules anything, or activates monitoring.

-- ---------------------------------------------------------------------------
-- community_recommendations
-- ---------------------------------------------------------------------------
-- One row per candidate listening source surfaced by the discovery engine.
-- A recommendation is ADVISORY until the user transitions it via the
-- explicit status flow. Activation creates a listening_sources row and
-- links it back via `activated_listening_source_id`.

CREATE TABLE IF NOT EXISTS community_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  source_identifier TEXT NOT NULL,
  display_name TEXT NOT NULL,
  recommendation_reason TEXT NOT NULL,
  recommendation_category TEXT NULL,
  confidence_score NUMERIC NOT NULL DEFAULT 0,
  estimated_signal_quality NUMERIC NOT NULL DEFAULT 0,
  estimated_volume INTEGER NOT NULL DEFAULT 0,
  estimated_cost INTEGER NOT NULL DEFAULT 0,
  strategic_relevance NUMERIC NOT NULL DEFAULT 0,
  related_keywords TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  related_competitors TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  recommendation_status TEXT NOT NULL DEFAULT 'suggested',
  source_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  activated_listening_source_id UUID NULL REFERENCES listening_sources(id) ON DELETE SET NULL,
  approved_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ NULL,
  dismissed_at TIMESTAMPTZ NULL,
  rejected_at TIMESTAMPTZ NULL,
  activated_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT community_recommendations_status_check
    CHECK (recommendation_status IN ('suggested','approved','rejected','dismissed','activated')),
  CONSTRAINT community_recommendations_score_bounds_check
    CHECK (
      confidence_score BETWEEN 0 AND 1
      AND estimated_signal_quality BETWEEN 0 AND 1
      AND strategic_relevance BETWEEN 0 AND 1
    ),
  CONSTRAINT community_recommendations_unique UNIQUE (organization_id, source_type, source_identifier)
);

CREATE INDEX IF NOT EXISTS idx_community_recommendations_org_status
  ON community_recommendations (organization_id, recommendation_status, strategic_relevance DESC);

CREATE INDEX IF NOT EXISTS idx_community_recommendations_org_created
  ON community_recommendations (organization_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- signal_intent_clusters
-- ---------------------------------------------------------------------------
-- Deterministic, bounded grouping of opportunity feed items by
-- (source_identifier, opportunity_type, normalised topic). cluster_key is a
-- short sha256 prefix of those inputs; one row per unique key per org.

CREATE TABLE IF NOT EXISTS signal_intent_clusters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  cluster_key TEXT NOT NULL,
  source_type TEXT NULL,
  source_identifier TEXT NULL,
  opportunity_type TEXT NOT NULL,
  top_keywords TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  signal_count INTEGER NOT NULL DEFAULT 0,
  avg_intent_score NUMERIC NULL,
  avg_urgency_score NUMERIC NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT signal_intent_clusters_unique UNIQUE (organization_id, cluster_key)
);

CREATE INDEX IF NOT EXISTS idx_signal_intent_clusters_org_last_seen
  ON signal_intent_clusters (organization_id, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_signal_intent_clusters_org_type
  ON signal_intent_clusters (organization_id, opportunity_type);

-- ---------------------------------------------------------------------------
-- opportunity_feed_items
-- ---------------------------------------------------------------------------
-- One row per persisted lead_signal that we have classified as an
-- opportunity. Carries the explanation payload required by the
-- "every surfaced opportunity must explain..." rule.

CREATE TABLE IF NOT EXISTS opportunity_feed_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  signal_id UUID NOT NULL REFERENCES lead_signals(id) ON DELETE CASCADE,
  cluster_id UUID NULL REFERENCES signal_intent_clusters(id) ON DELETE SET NULL,
  listening_execution_id UUID NULL REFERENCES listening_executions(id) ON DELETE SET NULL,
  opportunity_type TEXT NOT NULL,
  opportunity_score NUMERIC NOT NULL DEFAULT 0,
  confidence_score NUMERIC NOT NULL DEFAULT 0,
  urgency_score NUMERIC NOT NULL DEFAULT 0,
  source_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  detected_reason TEXT NOT NULL,
  matched_keywords TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  platform TEXT NOT NULL,
  source_identifier TEXT NULL,
  author_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  recommendation_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  explanation JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT opportunity_feed_items_signal_unique UNIQUE (organization_id, signal_id),
  CONSTRAINT opportunity_feed_items_type_check
    CHECK (opportunity_type IN (
      'buying_intent',
      'competitor_dissatisfaction',
      'hiring_signal',
      'migration_signal',
      'product_research',
      'integration_need',
      'support_frustration',
      'generic_interest'
    )),
  CONSTRAINT opportunity_feed_items_scores_bounds_check
    CHECK (
      opportunity_score BETWEEN 0 AND 1
      AND confidence_score BETWEEN 0 AND 1
      AND urgency_score BETWEEN 0 AND 1
    )
);

CREATE INDEX IF NOT EXISTS idx_opportunity_feed_items_org_created
  ON opportunity_feed_items (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_opportunity_feed_items_org_type_score
  ON opportunity_feed_items (organization_id, opportunity_type, opportunity_score DESC);

CREATE INDEX IF NOT EXISTS idx_opportunity_feed_items_org_platform_created
  ON opportunity_feed_items (organization_id, platform, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_opportunity_feed_items_cluster
  ON opportunity_feed_items (cluster_id)
  WHERE cluster_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION trg_phase4_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS community_recommendations_set_updated_at ON community_recommendations;
CREATE TRIGGER community_recommendations_set_updated_at
  BEFORE UPDATE ON community_recommendations
  FOR EACH ROW EXECUTE FUNCTION trg_phase4_set_updated_at();

DROP TRIGGER IF EXISTS signal_intent_clusters_set_updated_at ON signal_intent_clusters;
CREATE TRIGGER signal_intent_clusters_set_updated_at
  BEFORE UPDATE ON signal_intent_clusters
  FOR EACH ROW EXECUTE FUNCTION trg_phase4_set_updated_at();

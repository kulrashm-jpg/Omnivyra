-- Phase 5 — Multi-connector expansion, opportunity graph, identity resolution,
-- org learning memory, alert routing. Fully additive: no edits to existing
-- tables. Nothing here starts a worker or scheduler.

-- ---------------------------------------------------------------------------
-- OPPORTUNITY GRAPH
-- ---------------------------------------------------------------------------
-- Two-table projection (nodes + edges). Nodes are typed; an `external_id`
-- column anchors nodes to existing rows (opportunity_feed_items.id,
-- signal_intent_clusters.id, listening_sources.id, etc.). No edge gets
-- created without both endpoints already existing.

CREATE TABLE IF NOT EXISTS opportunity_graph_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  node_type TEXT NOT NULL,
  external_id TEXT NULL,
  display_name TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT opportunity_graph_nodes_type_check
    CHECK (node_type IN (
      'opportunity','signal','cluster','source','author',
      'organization','competitor','keyword','execution'
    )),
  CONSTRAINT opportunity_graph_nodes_unique UNIQUE (organization_id, node_type, external_id)
);

CREATE INDEX IF NOT EXISTS idx_opportunity_graph_nodes_org_type
  ON opportunity_graph_nodes (organization_id, node_type);

CREATE INDEX IF NOT EXISTS idx_opportunity_graph_nodes_org_updated
  ON opportunity_graph_nodes (organization_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS opportunity_graph_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source_node_id UUID NOT NULL REFERENCES opportunity_graph_nodes(id) ON DELETE CASCADE,
  target_node_id UUID NOT NULL REFERENCES opportunity_graph_nodes(id) ON DELETE CASCADE,
  edge_type TEXT NOT NULL,
  confidence_score NUMERIC NOT NULL DEFAULT 1.0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT opportunity_graph_edges_type_check
    CHECK (edge_type IN (
      'belongs_to_cluster','authored_by','from_source','matches_keyword',
      'mentions_competitor','produced_by_execution','similar_to',
      'identity_link','related_to'
    )),
  CONSTRAINT opportunity_graph_edges_confidence_bounds
    CHECK (confidence_score BETWEEN 0 AND 1),
  CONSTRAINT opportunity_graph_edges_no_self_loop
    CHECK (source_node_id <> target_node_id),
  CONSTRAINT opportunity_graph_edges_unique
    UNIQUE (organization_id, source_node_id, target_node_id, edge_type)
);

CREATE INDEX IF NOT EXISTS idx_opportunity_graph_edges_org_source
  ON opportunity_graph_edges (organization_id, source_node_id);

CREATE INDEX IF NOT EXISTS idx_opportunity_graph_edges_org_target
  ON opportunity_graph_edges (organization_id, target_node_id);

CREATE INDEX IF NOT EXISTS idx_opportunity_graph_edges_org_type
  ON opportunity_graph_edges (organization_id, edge_type);

-- ---------------------------------------------------------------------------
-- CROSS-SOURCE IDENTITY RESOLUTION
-- ---------------------------------------------------------------------------
-- Identity links are CANDIDATE relationships, not destructive merges. Each
-- row stores a probable same-author link between two (platform, handle)
-- pairs with a confidence score and a reversal-safe `link_status`.

CREATE TABLE IF NOT EXISTS author_identity_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  primary_platform TEXT NOT NULL,
  primary_handle TEXT NOT NULL,
  secondary_platform TEXT NOT NULL,
  secondary_handle TEXT NOT NULL,
  confidence_score NUMERIC NOT NULL DEFAULT 0,
  evidence_signals TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  link_status TEXT NOT NULL DEFAULT 'candidate',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  confirmed_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  confirmed_at TIMESTAMPTZ NULL,
  rejected_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT author_identity_links_status_check
    CHECK (link_status IN ('candidate','confirmed','rejected')),
  CONSTRAINT author_identity_links_confidence_bounds
    CHECK (confidence_score BETWEEN 0 AND 1),
  -- Canonical ordering on the pair so (a,b) and (b,a) cannot both exist.
  CONSTRAINT author_identity_links_canonical_order
    CHECK (
      (primary_platform || ':' || primary_handle)
        < (secondary_platform || ':' || secondary_handle)
    ),
  CONSTRAINT author_identity_links_unique
    UNIQUE (organization_id, primary_platform, primary_handle, secondary_platform, secondary_handle)
);

CREATE INDEX IF NOT EXISTS idx_author_identity_links_org_status
  ON author_identity_links (organization_id, link_status);

CREATE INDEX IF NOT EXISTS idx_author_identity_links_primary
  ON author_identity_links (organization_id, primary_platform, primary_handle);

CREATE INDEX IF NOT EXISTS idx_author_identity_links_secondary
  ON author_identity_links (organization_id, secondary_platform, secondary_handle);

-- ---------------------------------------------------------------------------
-- ORGANIZATION LEARNING MEMORY
-- ---------------------------------------------------------------------------
-- Tracks aggregate behavioural metrics over rolling windows. Bounded
-- historical retention is enforced by the application layer (purge older
-- than N days); Phase 5 ships the rolling-window read path only.

CREATE TABLE IF NOT EXISTS org_learning_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  metric_key TEXT NOT NULL,
  metric_subject TEXT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  metric_value NUMERIC NOT NULL DEFAULT 0,
  sample_count INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT org_learning_metrics_window_check CHECK (window_end > window_start),
  CONSTRAINT org_learning_metrics_unique
    UNIQUE (organization_id, metric_key, metric_subject, window_start)
);

CREATE INDEX IF NOT EXISTS idx_org_learning_metrics_org_key_recent
  ON org_learning_metrics (organization_id, metric_key, window_end DESC);

-- ---------------------------------------------------------------------------
-- ALERT ROUTING
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS alert_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  min_severity TEXT NOT NULL DEFAULT 'medium',
  rate_limit_minutes INTEGER NOT NULL DEFAULT 60,
  scope JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT alert_rules_type_check
    CHECK (alert_type IN (
      'high_intent_detected','competitor_spike','migration_cluster_detected',
      'execution_failure','moderation_spike','source_degradation'
    )),
  CONSTRAINT alert_rules_severity_check
    CHECK (min_severity IN ('low','medium','high','critical')),
  CONSTRAINT alert_rules_rate_limit_bounds
    CHECK (rate_limit_minutes >= 0 AND rate_limit_minutes <= 1440),
  CONSTRAINT alert_rules_unique UNIQUE (organization_id, alert_type)
);

CREATE INDEX IF NOT EXISTS idx_alert_rules_org_enabled
  ON alert_rules (organization_id, alert_type)
  WHERE enabled = TRUE;

CREATE TABLE IF NOT EXISTS alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  alert_rule_id UUID NULL REFERENCES alert_rules(id) ON DELETE SET NULL,
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  dedup_key TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_at TIMESTAMPTZ NULL,
  acknowledged_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  delivered_channels TEXT[] NOT NULL DEFAULT ARRAY['in_app']::TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT alerts_type_check
    CHECK (alert_type IN (
      'high_intent_detected','competitor_spike','migration_cluster_detected',
      'execution_failure','moderation_spike','source_degradation'
    )),
  CONSTRAINT alerts_severity_check
    CHECK (severity IN ('low','medium','high','critical'))
);

CREATE INDEX IF NOT EXISTS idx_alerts_org_created
  ON alerts (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alerts_org_unack
  ON alerts (organization_id, created_at DESC)
  WHERE acknowledged_at IS NULL;

-- Dedup: at most one row per (org, alert_type, dedup_key) per rolling
-- rate-limit window. Enforced by service layer using this index for
-- existence checks.
CREATE INDEX IF NOT EXISTS idx_alerts_org_dedup_recent
  ON alerts (organization_id, alert_type, dedup_key, created_at DESC);

-- ---------------------------------------------------------------------------
-- Updated_at triggers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION trg_phase5_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS opportunity_graph_nodes_set_updated_at ON opportunity_graph_nodes;
CREATE TRIGGER opportunity_graph_nodes_set_updated_at
  BEFORE UPDATE ON opportunity_graph_nodes
  FOR EACH ROW EXECUTE FUNCTION trg_phase5_set_updated_at();

DROP TRIGGER IF EXISTS author_identity_links_set_updated_at ON author_identity_links;
CREATE TRIGGER author_identity_links_set_updated_at
  BEFORE UPDATE ON author_identity_links
  FOR EACH ROW EXECUTE FUNCTION trg_phase5_set_updated_at();

DROP TRIGGER IF EXISTS org_learning_metrics_set_updated_at ON org_learning_metrics;
CREATE TRIGGER org_learning_metrics_set_updated_at
  BEFORE UPDATE ON org_learning_metrics
  FOR EACH ROW EXECUTE FUNCTION trg_phase5_set_updated_at();

DROP TRIGGER IF EXISTS alert_rules_set_updated_at ON alert_rules;
CREATE TRIGGER alert_rules_set_updated_at
  BEFORE UPDATE ON alert_rules
  FOR EACH ROW EXECUTE FUNCTION trg_phase5_set_updated_at();

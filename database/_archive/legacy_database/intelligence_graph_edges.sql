-- =====================================================
-- INTELLIGENCE GRAPH EDGES
-- Phase 3: Cross-signal relationship graph
-- =====================================================
-- Run after: intelligence_signals (must exist)
-- =====================================================

CREATE TABLE IF NOT EXISTS intelligence_graph_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_signal_id UUID NOT NULL REFERENCES intelligence_signals(id) ON DELETE CASCADE,
  target_signal_id UUID NOT NULL REFERENCES intelligence_signals(id) ON DELETE CASCADE,
  edge_type TEXT NOT NULL,
  edge_strength NUMERIC NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  CHECK (source_signal_id != target_signal_id)
);

CREATE INDEX IF NOT EXISTS index_intelligence_graph_edges_source
  ON intelligence_graph_edges (source_signal_id);

CREATE INDEX IF NOT EXISTS index_intelligence_graph_edges_target
  ON intelligence_graph_edges (target_signal_id);

CREATE INDEX IF NOT EXISTS index_intelligence_graph_edges_type
  ON intelligence_graph_edges (edge_type);

-- Prevent duplicate edges of same type between same pair
ALTER TABLE intelligence_graph_edges
  DROP CONSTRAINT IF EXISTS intelligence_graph_edges_source_target_type_key;
ALTER TABLE intelligence_graph_edges
  ADD CONSTRAINT intelligence_graph_edges_source_target_type_key
  UNIQUE (source_signal_id, target_signal_id, edge_type);

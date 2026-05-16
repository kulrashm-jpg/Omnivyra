export const GRAPH_NODE_TYPES = [
  'opportunity',
  'signal',
  'cluster',
  'source',
  'author',
  'organization',
  'competitor',
  'keyword',
  'execution',
] as const;
export type GraphNodeType = (typeof GRAPH_NODE_TYPES)[number];

export const GRAPH_EDGE_TYPES = [
  'belongs_to_cluster',
  'authored_by',
  'from_source',
  'matches_keyword',
  'mentions_competitor',
  'produced_by_execution',
  'similar_to',
  'identity_link',
  'related_to',
] as const;
export type GraphEdgeType = (typeof GRAPH_EDGE_TYPES)[number];

export type GraphNode = {
  id: string;
  organization_id: string;
  node_type: GraphNodeType;
  external_id: string | null;
  display_name: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type GraphEdge = {
  id: string;
  organization_id: string;
  source_node_id: string;
  target_node_id: string;
  edge_type: GraphEdgeType;
  confidence_score: number;
  metadata: Record<string, unknown>;
  created_at: string;
};

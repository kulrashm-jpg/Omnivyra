export const SEMANTIC_SOURCE_KINDS = [
  'opportunity_feed_item',
  'opportunity_note',
  'signal_intent_cluster',
  'listening_execution',
  'graph_node',
  'escalation',
  'investigation_workspace_item',
] as const;
export type SemanticSourceKind = (typeof SEMANTIC_SOURCE_KINDS)[number];

export type SemanticIndexEntry = {
  id: string;
  organization_id: string;
  source_kind: SemanticSourceKind;
  source_id: string;
  chunk_index: number;
  content_excerpt: string;
  content_hash: string;
  embedding_provider: string | null;
  embedding_dim: number | null;
  // Stored as JSONB (number[]) until a future phase switches to pgvector.
  embedding_vector: number[] | null;
  metadata: Record<string, unknown>;
  indexed_at: string;
};

// Bounds. Phase 7 keeps everything modest until the embedding writer
// arrives in a later phase.
export const SEMANTIC_CHUNK_MAX_CHARS = 2000 as const;
export const SEMANTIC_MAX_CHUNKS_PER_SOURCE = 5 as const;

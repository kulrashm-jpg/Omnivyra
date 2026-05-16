export const RETRIEVAL_MODES = ['lexical_only', 'semantic_only', 'hybrid'] as const;
export type RetrievalMode = (typeof RETRIEVAL_MODES)[number];

export const RETRIEVAL_DEFAULT_TOPK = 20 as const;
export const RETRIEVAL_MAX_TOPK = 100 as const;
export const RETRIEVAL_EXPLANATION_TTL_HOURS = 24 as const;

export type RetrievalHit = {
  source_kind: string;
  source_id: string;
  chunk_id: string | null;
  lexical_score: number;
  semantic_score: number;
  combined_score: number;
  preview: string | null;
  explanation: string;
};

export type RetrievalComposition = {
  lexical_weight: number;
  semantic_weight: number;
  k_lexical_candidates: number;
  k_semantic_candidates: number;
  reranked: boolean;
};

export type SemanticRetrievalExplanation = {
  id: string;
  organization_id: string;
  query_hash: string;
  query_text: string;
  retrieval_mode: RetrievalMode;
  hits: RetrievalHit[];
  composition: RetrievalComposition;
  requested_by: string | null;
  created_at: string;
};

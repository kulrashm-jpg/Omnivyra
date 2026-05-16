import type { SemanticSourceKind } from './semanticIndex';

export const SEMANTIC_JOB_STATUSES = ['queued', 'running', 'complete', 'failed', 'cancelled'] as const;
export type SemanticJobStatus = (typeof SEMANTIC_JOB_STATUSES)[number];

export const SEMANTIC_INDEXING_MAX_SOURCES_PER_JOB = 50 as const;
export const SEMANTIC_INDEXING_DEFAULT_DIM = 32 as const;
export const SEMANTIC_INDEXING_QUEUE_NAME = 'semantic-indexing' as const;

export type SemanticIndexingJob = {
  id: string;
  organization_id: string;
  source_kind: SemanticSourceKind;
  source_ids: string[];
  status: SemanticJobStatus;
  embedding_provider: string;
  embedding_dim: number;
  chunks_indexed: number;
  chunks_failed: number;
  cost_units: number;
  failure_reason: string | null;
  requested_by: string | null;
  started_at: string | null;
  completed_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

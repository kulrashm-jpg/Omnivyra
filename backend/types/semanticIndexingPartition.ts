export const SEMANTIC_PARTITION_STATUSES = [
  'queued',
  'running',
  'complete',
  'failed',
  'cancelled',
] as const;
export type SemanticPartitionStatus = (typeof SEMANTIC_PARTITION_STATUSES)[number];

export const SEMANTIC_PARTITION_MAX_ATTEMPTS = 5 as const;
export const SEMANTIC_PARTITION_DEFAULT_SIZE = 25 as const;
export const SEMANTIC_PARTITION_QUEUE_NAME = 'semantic-indexing' as const;

export type SemanticIndexingPartition = {
  id: string;
  organization_id: string;
  semantic_indexing_job_id: string;
  partition_index: number;
  source_ids: string[];
  status: SemanticPartitionStatus;
  attempts_made: number;
  worker_id: string | null;
  chunks_indexed: number;
  chunks_failed: number;
  cost_units: number;
  started_at: string | null;
  completed_at: string | null;
  failure_reason: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

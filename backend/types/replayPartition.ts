export const REPLAY_PARTITION_STATUSES = [
  'queued',
  'running',
  'complete',
  'failed',
  'cancelled',
] as const;
export type ReplayPartitionStatus = (typeof REPLAY_PARTITION_STATUSES)[number];

export const REPLAY_PARTITION_MAX_ATTEMPTS = 5 as const;
export const REPLAY_PARTITION_DEFAULT_SIZE = 25 as const;
export const REPLAY_PARTITION_QUEUE_NAME = 'replay-partition' as const;

export type ReplayCheckpoint = {
  last_item_ref: string | null;
  processed_count: number;
  skipped_count: number;
  resumable: boolean;
};

export type ReplayPartition = {
  id: string;
  organization_id: string;
  replay_operation_id: string;
  partition_index: number;
  status: ReplayPartitionStatus;
  worker_id: string | null;
  item_ids: string[];
  checkpoint: ReplayCheckpoint;
  processed_count: number;
  skipped_count: number;
  attempts_made: number;
  started_at: string | null;
  completed_at: string | null;
  failure_reason: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

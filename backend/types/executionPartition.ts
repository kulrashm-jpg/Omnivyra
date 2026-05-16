export const PARTITION_STATUSES = ['idle', 'leased', 'expired', 'released', 'quarantined'] as const;
export type PartitionStatus = (typeof PARTITION_STATUSES)[number];

export const DEFAULT_LEASE_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const HEARTBEAT_INTERVAL_MS = 30_000;        // 30 seconds
export const MAX_LEASE_RECOVERY_BATCH = 50 as const;

export type ExecutionPartition = {
  id: string;
  organization_id: string;
  partition_key: string;
  owner_worker_id: string | null;
  lease_acquired_at: string | null;
  lease_expires_at: string | null;
  heartbeat_at: string | null;
  status: PartitionStatus;
  released_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

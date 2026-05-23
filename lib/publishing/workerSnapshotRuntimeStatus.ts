// Advisory Runtime Status Model — Worker Snapshot Consumption
//
// Deterministic, advisory-only statuses for shadow worker snapshot consumption.
// These describe shadow-mode observations — they NEVER gate runtime, block
// publishing, or mutate anything.

export type SnapshotRuntimeStatus =
  | 'snapshot_runtime_clean'
  | 'snapshot_runtime_warning'
  | 'snapshot_runtime_risk'
  | 'snapshot_runtime_invalid';

export type SnapshotRuntimeSeverity = 'clean' | 'warning' | 'risk' | 'invalid';

export const SNAPSHOT_RUNTIME_STATUSES: readonly SnapshotRuntimeStatus[] = [
  'snapshot_runtime_clean',
  'snapshot_runtime_warning',
  'snapshot_runtime_risk',
  'snapshot_runtime_invalid',
];

export interface SnapshotRuntimeFinding {
  code: string;
  severity: SnapshotRuntimeSeverity;
  message: string;
}

const SEVERITY_TO_STATUS: Record<SnapshotRuntimeSeverity, SnapshotRuntimeStatus> = {
  clean: 'snapshot_runtime_clean',
  warning: 'snapshot_runtime_warning',
  risk: 'snapshot_runtime_risk',
  invalid: 'snapshot_runtime_invalid',
};

const STATUS_RANK: Record<SnapshotRuntimeStatus, number> = {
  snapshot_runtime_clean: 0,
  snapshot_runtime_warning: 1,
  snapshot_runtime_risk: 2,
  snapshot_runtime_invalid: 3,
};

export function rankSnapshotRuntimeStatus(status: SnapshotRuntimeStatus): number {
  return STATUS_RANK[status];
}

export function isCleanSnapshotRuntimeStatus(status: SnapshotRuntimeStatus): boolean {
  return status === 'snapshot_runtime_clean';
}

// Worst-severity-wins aggregation across findings.
export function deriveSnapshotRuntimeStatus(
  items: readonly { severity: SnapshotRuntimeSeverity }[],
): SnapshotRuntimeStatus {
  let status: SnapshotRuntimeStatus = 'snapshot_runtime_clean';
  for (const item of items) {
    const candidate = SEVERITY_TO_STATUS[item.severity];
    if (STATUS_RANK[candidate] > STATUS_RANK[status]) status = candidate;
  }
  return status;
}

// Worst-severity-wins aggregation across statuses.
export function worstSnapshotRuntimeStatus(
  statuses: readonly SnapshotRuntimeStatus[],
): SnapshotRuntimeStatus {
  let status: SnapshotRuntimeStatus = 'snapshot_runtime_clean';
  for (const candidate of statuses) {
    if (STATUS_RANK[candidate] > STATUS_RANK[status]) status = candidate;
  }
  return status;
}

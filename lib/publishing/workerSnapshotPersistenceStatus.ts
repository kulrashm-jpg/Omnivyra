// Persistence Status Model — Worker Shadow Telemetry
//
// Deterministic, advisory-only statuses for shadow telemetry persistence.
// These describe persistence-layer health and the severity of what was
// persisted — they NEVER gate runtime or block publishing.

export type PersistenceStatus =
  | 'persistence_clean'
  | 'persistence_warning'
  | 'persistence_risk'
  | 'persistence_invalid';

export const PERSISTENCE_STATUSES: readonly PersistenceStatus[] = [
  'persistence_clean',
  'persistence_warning',
  'persistence_risk',
  'persistence_invalid',
];

const STATUS_RANK: Record<PersistenceStatus, number> = {
  persistence_clean: 0,
  persistence_warning: 1,
  persistence_risk: 2,
  persistence_invalid: 3,
};

export function rankPersistenceStatus(status: PersistenceStatus): number {
  return STATUS_RANK[status];
}

export function isCleanPersistenceStatus(status: PersistenceStatus): boolean {
  return status === 'persistence_clean';
}

export function worstPersistenceStatus(statuses: readonly PersistenceStatus[]): PersistenceStatus {
  let status: PersistenceStatus = 'persistence_clean';
  for (const candidate of statuses) {
    if (STATUS_RANK[candidate] > STATUS_RANK[status]) status = candidate;
  }
  return status;
}

export interface PersistenceStatusInput {
  successCount: number;
  failureCount: number;
  runtimeInvalidPersistenceCount: number;
  ownershipDriftPersistenceCount: number;
}

// Worst-wins: persisted ownership drift dominates (invalid); persisted runtime
// invalid state is a risk; any persistence failure is an advisory warning.
export function derivePersistenceStatus(input: PersistenceStatusInput): PersistenceStatus {
  if (input.ownershipDriftPersistenceCount > 0) return 'persistence_invalid';
  if (input.runtimeInvalidPersistenceCount > 0) return 'persistence_risk';
  if (input.failureCount > 0) return 'persistence_warning';
  return 'persistence_clean';
}

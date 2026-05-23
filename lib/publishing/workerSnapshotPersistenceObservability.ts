// Runtime Persistence Observability — Worker Shadow Telemetry
//
// Deterministic, advisory-only aggregation of shadow telemetry persistence
// events. Summarizes persistence success/failure and the severity of what was
// persisted. No runtime decisions, no gating.

import type { SnapshotRuntimeStatus } from './workerSnapshotRuntimeStatus';
import {
  derivePersistenceStatus,
  type PersistenceStatus,
} from './workerSnapshotPersistenceStatus';

export interface WorkerSnapshotPersistenceEvent {
  persisted: boolean;
  runtimeStatus: SnapshotRuntimeStatus | null;
  ownershipDrift: boolean;
  unresolved: boolean;
}

export interface WorkerSnapshotPersistenceObservability {
  version: 'worker-snapshot-persistence-observability-v1';
  generatedAt: string;
  status: PersistenceStatus;
  attempts: number;
  persistenceSuccessCount: number;
  persistenceFailureCount: number;
  runtimeTelemetryPersistenceRate: number;
  runtimeInvalidPersistenceCount: number;
  ownershipDriftPersistenceCount: number;
  unresolvedSnapshotPersistenceCount: number;
}

export function summarizeWorkerSnapshotPersistence(
  events: readonly WorkerSnapshotPersistenceEvent[],
): WorkerSnapshotPersistenceObservability {
  let persistenceSuccessCount = 0;
  let persistenceFailureCount = 0;
  let runtimeInvalidPersistenceCount = 0;
  let ownershipDriftPersistenceCount = 0;
  let unresolvedSnapshotPersistenceCount = 0;

  for (const event of events) {
    if (event.persisted) {
      persistenceSuccessCount += 1;
      if (event.runtimeStatus === 'snapshot_runtime_invalid') runtimeInvalidPersistenceCount += 1;
      if (event.ownershipDrift) ownershipDriftPersistenceCount += 1;
      if (event.unresolved) unresolvedSnapshotPersistenceCount += 1;
    } else {
      persistenceFailureCount += 1;
    }
  }

  const attempts = events.length;
  return {
    version: 'worker-snapshot-persistence-observability-v1',
    generatedAt: new Date(0).toISOString(),
    status: derivePersistenceStatus({
      successCount: persistenceSuccessCount,
      failureCount: persistenceFailureCount,
      runtimeInvalidPersistenceCount,
      ownershipDriftPersistenceCount,
    }),
    attempts,
    persistenceSuccessCount,
    persistenceFailureCount,
    runtimeTelemetryPersistenceRate: attempts > 0 ? persistenceSuccessCount / attempts : 0,
    runtimeInvalidPersistenceCount,
    ownershipDriftPersistenceCount,
    unresolvedSnapshotPersistenceCount,
  };
}

export function serializeWorkerSnapshotPersistenceObservability(
  observability: WorkerSnapshotPersistenceObservability,
): string {
  return [
    '## WORKER SNAPSHOT PERSISTENCE OBSERVABILITY',
    `Version: ${observability.version}`,
    `Status: ${observability.status}`,
    `Attempts: ${observability.attempts}`,
    `Success/failure: ${observability.persistenceSuccessCount}/${observability.persistenceFailureCount}`,
    `Persistence rate: ${observability.runtimeTelemetryPersistenceRate}`,
    `Runtime invalid persisted: ${observability.runtimeInvalidPersistenceCount}`,
    `Ownership drift persisted: ${observability.ownershipDriftPersistenceCount}`,
    `Unresolved snapshot persisted: ${observability.unresolvedSnapshotPersistenceCount}`,
  ].join('\n');
}

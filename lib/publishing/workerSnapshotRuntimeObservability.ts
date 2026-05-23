// Snapshot Runtime Observability — Worker Shadow Consumption
//
// Deterministic, non-mutating aggregation of worker shadow consumption results
// into operator-readable summaries: snapshot load, drift, integrity,
// resolution, risk, and gap summaries.

import type { DriftKind } from './workerSnapshotDriftVerification';
import type { WorkerShadowConsumptionResult } from './workerShadowSnapshotConsumption';
import {
  worstSnapshotRuntimeStatus,
  type SnapshotRuntimeStatus,
} from './workerSnapshotRuntimeStatus';

const DRIFT_KINDS: readonly DriftKind[] = [
  'content',
  'seo',
  'media',
  'taxonomy',
  'slug',
  'publish_metadata',
  'company_ownership',
];

export interface WorkerSnapshotRuntimeObservability {
  version: 'worker-snapshot-runtime-observability-v1';
  generatedAt: string;
  totalConsumptions: number;
  overallStatus: SnapshotRuntimeStatus;
  loadSummary: { loaded: number; notLoaded: number };
  driftSummary: { withDrift: number; clean: number; byKind: Record<DriftKind, number> };
  integritySummary: { contractResolved: number; publishTargetResolved: number; idempotencyResolved: number };
  resolutionSummary: { resolved: number; unresolved: number };
  statusSummary: Record<SnapshotRuntimeStatus, number>;
  riskSummary: readonly string[];
  gapSummary: readonly string[];
}

export function summarizeWorkerSnapshotRuntime(
  results: readonly WorkerShadowConsumptionResult[],
): WorkerSnapshotRuntimeObservability {
  const byKind: Record<DriftKind, number> = {
    content: 0, seo: 0, media: 0, taxonomy: 0, slug: 0, publish_metadata: 0, company_ownership: 0,
  };
  const statusSummary: Record<SnapshotRuntimeStatus, number> = {
    snapshot_runtime_clean: 0,
    snapshot_runtime_warning: 0,
    snapshot_runtime_risk: 0,
    snapshot_runtime_invalid: 0,
  };
  let loaded = 0;
  let notLoaded = 0;
  let withDrift = 0;
  let clean = 0;
  let contractResolved = 0;
  let publishTargetResolved = 0;
  let idempotencyResolved = 0;
  let resolved = 0;
  let unresolved = 0;
  const risk = new Set<string>();
  const gaps = new Set<string>();

  for (const result of results) {
    statusSummary[result.status] += 1;
    if (result.snapshotLoaded) loaded += 1;
    else notLoaded += 1;
    if (result.contractResolved) contractResolved += 1;
    if (result.publishTargetResolved) publishTargetResolved += 1;
    if (result.idempotencyResolved) idempotencyResolved += 1;
    if (result.resolution.resolved) resolved += 1;
    else unresolved += 1;
    if (result.driftReport && result.driftReport.hasDrift) {
      withDrift += 1;
      for (const kind of result.driftReport.driftKinds) byKind[kind] += 1;
    } else {
      clean += 1;
    }
    for (const finding of result.findings) {
      if (finding.severity === 'invalid' || finding.severity === 'risk') risk.add(finding.message);
      if (finding.severity === 'warning') gaps.add(finding.message);
    }
  }

  const statuses = results.map((result) => result.status);
  for (const kind of DRIFT_KINDS) {
    if (!(kind in byKind)) byKind[kind] = 0;
  }

  return {
    version: 'worker-snapshot-runtime-observability-v1',
    generatedAt: new Date(0).toISOString(),
    totalConsumptions: results.length,
    overallStatus: worstSnapshotRuntimeStatus(statuses.length > 0 ? statuses : ['snapshot_runtime_clean']),
    loadSummary: { loaded, notLoaded },
    driftSummary: { withDrift, clean, byKind },
    integritySummary: { contractResolved, publishTargetResolved, idempotencyResolved },
    resolutionSummary: { resolved, unresolved },
    statusSummary,
    riskSummary: [...risk].sort(),
    gapSummary: [...gaps].sort(),
  };
}

export function serializeWorkerSnapshotRuntimeObservability(
  observability: WorkerSnapshotRuntimeObservability,
): string {
  return [
    '## WORKER SNAPSHOT RUNTIME OBSERVABILITY',
    `Version: ${observability.version}`,
    `Total consumptions: ${observability.totalConsumptions}`,
    `Overall status: ${observability.overallStatus}`,
    `Loaded/not loaded: ${observability.loadSummary.loaded}/${observability.loadSummary.notLoaded}`,
    `With drift/clean: ${observability.driftSummary.withDrift}/${observability.driftSummary.clean}`,
    `Resolved/unresolved: ${observability.resolutionSummary.resolved}/${observability.resolutionSummary.unresolved}`,
    `Risk summary: ${observability.riskSummary.join('; ') || 'none'}`,
    `Gap summary: ${observability.gapSummary.join('; ') || 'none'}`,
  ].join('\n');
}

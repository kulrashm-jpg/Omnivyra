/*
SCRIPT_CLASSIFICATION: OPERATOR_SUPPORT
MUTATION_LEVEL: NONE
SAFE_FOR_CI: NO
SAFE_FOR_PRODUCTION: YES
REQUIRES_EXPLICIT_OPERATOR_INTENT: NO
*/
/**
 * Snapshot Runtime Readiness Printer
 *
 * Read-only orchestrator. Runs the migration/schema verification, the Redis
 * TLS verification, and a read-only shadow soak, then aggregates everything
 * into a single advisory readiness verdict: READY / CONDITIONAL / NOT_READY.
 *
 * Advisory only — it activates nothing and mutates nothing.
 *
 * Run:
 *   SUPABASE_DB_URL=... REDIS_URL=rediss://... npx tsx scripts/operator/printSnapshotRuntimeReadiness.ts
 */

import { aggregateRuntimeReadiness, type RuntimeReadinessResult } from './snapshotPublishingOperatorCore';
import { verifySnapshotPublishingRuntime } from './verifySnapshotPublishingRuntime';
import { verifyRedisTlsRuntime } from './verifyRedisTlsRuntime';
import { runSnapshotShadowSoak } from './runSnapshotShadowSoak';

export interface SnapshotRuntimeReadinessReport {
  generatedAt: string;
  readiness: RuntimeReadinessResult;
  migrationVerification: Awaited<ReturnType<typeof verifySnapshotPublishingRuntime>>;
  redisVerification: Awaited<ReturnType<typeof verifyRedisTlsRuntime>>;
  soakExecuted: boolean;
  shadowSoakStatus: string | null;
}

export async function buildSnapshotRuntimeReadinessReport(): Promise<SnapshotRuntimeReadinessReport> {
  const migrationVerification = await verifySnapshotPublishingRuntime();
  const redisVerification = await verifyRedisTlsRuntime();
  const soak = await runSnapshotShadowSoak({ persistSummaries: false });
  const report = soak.report;

  const readiness = aggregateRuntimeReadiness({
    migrationsApplied:
      migrationVerification.contentPublishSnapshotsTable && migrationVerification.workerShadowTelemetryTable,
    triggersPresent:
      migrationVerification.immutabilityTriggerPresent && migrationVerification.appendOnlyTriggerPresent,
    indexesPresent: migrationVerification.indexesPresent,
    telemetryTableAccessible: migrationVerification.workerShadowTelemetryTable,
    redisTls: redisVerification.ok,
    soakStatus: report ? report.shadowSoakStatus : null,
    persistenceStatus: null,
    crossCompanyOwnershipDriftCount: report ? report.metrics.crossCompanyOwnershipDriftCount : null,
  });

  return {
    generatedAt: new Date(0).toISOString(),
    readiness,
    migrationVerification,
    redisVerification,
    soakExecuted: soak.executed,
    shadowSoakStatus: report ? report.shadowSoakStatus : null,
  };
}

async function main(): Promise<number> {
  const report = await buildSnapshotRuntimeReadinessReport();
  console.log(JSON.stringify({ scope: 'snapshot-runtime-readiness', ...report }, null, 2));
  console.log(`\nREADINESS: ${report.readiness.readiness}`);
  for (const reason of report.readiness.reasons) console.log(`  - ${reason}`);
  return report.readiness.readiness === 'NOT_READY' ? 1 : 0;
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

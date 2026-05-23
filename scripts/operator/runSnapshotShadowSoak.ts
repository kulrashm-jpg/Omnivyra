/*
SCRIPT_CLASSIFICATION: OPERATOR
MUTATION_LEVEL: APPEND_ONLY_TELEMETRY
SAFE_FOR_CI: NO
SAFE_FOR_PRODUCTION: CAUTION
REQUIRES_EXPLICIT_OPERATOR_INTENT: YES
*/
/**
 * Snapshot Shadow Soak Runner CLI
 *
 * Runs `runWorkerSnapshotShadowSoakCycle` against persisted shadow telemetry
 * rows and prints the soak report. With `--persist`, append-only soak summary
 * rows are written; without it the soak is read-only.
 *
 * It NEVER activates snapshot publishing, alters retries, or touches queues /
 * the scheduler — it only reads telemetry and (optionally) appends summaries.
 *
 * Run:
 *   npx tsx scripts/operator/runSnapshotShadowSoak.ts --soak-cycle=<id>
 *   npx tsx scripts/operator/runSnapshotShadowSoak.ts --soak-cycle=<id> --persist --target-env=local
 */

import { enforceOperatorSafety } from '../_core/operatorSafety';
import { currentSoakCycleId } from '../../lib/publishing/workerSnapshotShadowSoakCycle';
import {
  runWorkerSnapshotShadowSoakCycle,
  type ShadowSoakCycleResult,
} from '../../backend/services/workerSnapshotShadowSoakRunner';

function argValue(flag: string): string | null {
  const match = process.argv.slice(2).find((arg) => arg.startsWith(`${flag}=`));
  return match ? match.slice(flag.length + 1) : null;
}

export async function runSnapshotShadowSoak(
  options: { soakCycleId?: string; persistSummaries?: boolean } = {},
): Promise<ShadowSoakCycleResult> {
  const soakCycleId = options.soakCycleId || currentSoakCycleId();
  return runWorkerSnapshotShadowSoakCycle({
    soakCycleId,
    persistSummaries: options.persistSummaries ?? false,
  });
}

async function main(): Promise<number> {
  const persist = process.argv.slice(2).includes('--persist');
  if (persist) {
    const safety = enforceOperatorSafety({
      scriptName: 'scripts/operator/runSnapshotShadowSoak.ts',
      mutationTarget: 'worker_snapshot_shadow_telemetry (append-only)',
      intendedAction: 'run a shadow soak cycle and append soak summary telemetry rows',
      example: 'npx tsx scripts/operator/runSnapshotShadowSoak.ts --soak-cycle=<id> --persist --target-env=local',
    });
    if (!safety.allowed) return 0;
  }

  const result = await runSnapshotShadowSoak({
    soakCycleId: argValue('--soak-cycle') ?? undefined,
    persistSummaries: persist,
  });

  const report = result.report;
  console.log(JSON.stringify({
    scope: 'run-snapshot-shadow-soak',
    executed: result.executed,
    persisted: result.persisted,
    reasons: result.reasons,
    shadowSoakStatus: report?.shadowSoakStatus ?? null,
    persistenceStatus: null,
    telemetryCount: report?.telemetryCount ?? 0,
    runtimeStatusDistribution: report?.stability.runtimeStatusDistribution ?? null,
    ownershipDriftCount: report?.metrics.crossCompanyOwnershipDriftCount ?? null,
    compatibilityWarningCount: report?.metrics.snapshotCompatibilityWarnings ?? null,
    runtimeInvalidCount: report?.stability.runtimeStatusDistribution.snapshot_runtime_invalid ?? null,
    operationalReport: report?.operationalReport ?? null,
  }, null, 2));
  return result.executed ? 0 : 1;
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

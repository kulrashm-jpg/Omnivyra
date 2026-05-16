/**
 * CLI — Idempotency Health Report
 *
 * Read-only diagnostic. Reports the current stuck-state surface + the
 * in-memory recovery counters. NEVER mutates anything (no --apply flag).
 *
 * Usage:
 *   npx tsx scripts/audit/idempotency-health-report.ts [--org=<uuid>] [--json]
 *
 * Exit code: always 0 (this is a report, not a gate). Use
 * flush-stale-idempotency.ts to act on the findings.
 */

import { findStuckOperations } from '../../backend/services/billing/idempotency/idempotencyRecoveryService';
import { cleanStaleApiIdempotencyKeys } from '../../backend/services/billing/idempotency/apiIdempotencyKeyCleaner';
import { snapshotBillingMetrics } from '../../backend/services/billing/billingMetrics';

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const orgFilter = argv.find(a => a.startsWith('--org='))?.slice('--org='.length);
  const asJson = argv.includes('--json');

  const stuck = await findStuckOperations({ limit: 500 });
  const filtered = orgFilter ? stuck.filter(s => s.organizationId === orgFilter) : stuck;

  // Dry-run the cleaner to enumerate stuck middleware rows without mutating.
  const midPreview = await cleanStaleApiIdempotencyKeys({ dryRun: true, limit: 500 });

  const bySurface: Record<string, number> = {};
  for (const s of filtered) bySurface[s.surface] = (bySurface[s.surface] ?? 0) + 1;

  const oldest = filtered.reduce((max, s) => Math.max(max, s.ageSec), 0);

  const metrics = snapshotBillingMetrics();
  const recoveryMetrics = {
    stale_operation_auto_recovered_total: metrics.stale_operation_auto_recovered_total,
    manual_recovery_actions_total:        metrics.manual_recovery_actions_total,
    recovery_retry_total:                 metrics.recovery_retry_total,
    reconciliation_after_recovery_total:  metrics.reconciliation_after_recovery_total,
    heartbeat_timeout_total:              metrics.heartbeat_timeout_total,
    stale_operation_recovered_total:      metrics.stale_operation_recovered_total,
    idempotency_expired_total:            metrics.idempotency_expired_total,
    recovery_action_total:                metrics.recovery_action_total,
  };

  const report = {
    generatedAt: new Date().toISOString(),
    orgFilter:   orgFilter ?? null,
    operationalStuck: {
      total: filtered.length,
      bySurface,
      oldestAgeSec: oldest,
    },
    middlewareProcessingStuck: {
      total: midPreview.scanned,
      sample: midPreview.staleKeys.slice(0, 10),
    },
    recoveryMetrics,
    selfHealingHealthy: filtered.length === 0 && midPreview.scanned === 0,
  };

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }

  console.log('=== Idempotency Health Report ===');
  console.log(`generated:  ${report.generatedAt}`);
  console.log(`org filter: ${report.orgFilter ?? '(all)'}`);
  console.log('');
  console.log('Operational stuck operations:');
  console.log(`  total:        ${report.operationalStuck.total}`);
  for (const [surface, n] of Object.entries(bySurface)) {
    console.log(`    ${surface.padEnd(28)} ${n}`);
  }
  console.log(`  oldest age:   ${oldest}s`);
  console.log('');
  console.log('Middleware (api_idempotency_keys) stuck in processing:');
  console.log(`  total:        ${report.middlewareProcessingStuck.total}`);
  for (const k of report.middlewareProcessingStuck.sample) {
    console.log(`    - ${k.scope} :: ${k.idempotency_key}  locked_at=${k.locked_at}`);
  }
  console.log('');
  console.log('Recovery metrics (in-process counters since boot):');
  for (const [k, v] of Object.entries(recoveryMetrics)) {
    console.log(`  ${k.padEnd(38)} ${v}`);
  }
  console.log('');
  console.log(report.selfHealingHealthy
    ? 'STATUS: HEALTHY — no stuck idempotency state.'
    : 'STATUS: ATTENTION — run flush-stale-idempotency.ts (or wait for the 5-min cron).');

  return 0;
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error('FATAL', err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}

export { main as idempotencyHealthReport };

/*
SCRIPT_CLASSIFICATION: OPERATOR
MUTATION_LEVEL: BILLING_MUTATION
SAFE_FOR_CI: NO
SAFE_FOR_PRODUCTION: CAUTION
REQUIRES_EXPLICIT_OPERATOR_INTENT: YES
*/
/**
 * CLI — Flush Stale Idempotency
 *
 * Operator-safe replacement for hand-written UPDATE SQL. Finalizes stuck
 * `processing` rows in `api_idempotency_keys` AND stuck operational rows
 * (billing_operations / job_execution_registry / credit_action_approvals).
 *
 * Usage:
 *   npx tsx scripts/audit/flush-stale-idempotency.ts [flags]
 *
 * Flags (all optional):
 *   --dry-run                 preview only; mutate nothing
 *   --scope=<scope>           middleware scope filter (e.g. admin-credits-grant)
 *   --age-sec=<n>             only rows older than n seconds (default: SLA windows)
 *   --limit=<n>               max rows per surface (default: 200)
 *
 * Safety:
 *   - NEVER issues raw SQL. Routes through the same recovery service the
 *     cron uses (drift-checked, audit-logged, replay-safe).
 *   - The actor is recorded as `system:cli-flush-<os-user>` for audit.
 *   - Exit code 0 on success, 1 if any drift-refusal or error occurred.
 */

import os from 'os';
import { cleanStaleApiIdempotencyKeys } from '../../../backend/services/billing/idempotency/apiIdempotencyKeyCleaner';
import { reconcileStuckOperations } from '../../../backend/services/billing/idempotency/idempotencyRecoveryService';
import { enforceOperatorSafety } from '../../_core/operatorSafety';

function parseFlags(argv: string[]): {
  dryRun: boolean;
  scope?: string;
  ageSec?: number;
  limit: number;
} {
  const flags = { dryRun: false, scope: undefined as string | undefined, ageSec: undefined as number | undefined, limit: 200 };
  for (const arg of argv) {
    if (arg === '--dry-run') flags.dryRun = true;
    else if (arg.startsWith('--scope=')) flags.scope = arg.slice('--scope='.length);
    else if (arg.startsWith('--age-sec=')) {
      const n = Number(arg.slice('--age-sec='.length));
      if (Number.isFinite(n) && n > 0) flags.ageSec = n;
    } else if (arg.startsWith('--limit=')) {
      const n = Number(arg.slice('--limit='.length));
      if (Number.isFinite(n) && n > 0) flags.limit = n;
    }
  }
  return flags;
}

async function main(): Promise<number> {
  const safety = enforceOperatorSafety({
    scriptName: 'scripts/operator/billing/flush-stale-idempotency.ts',
    mutationTarget: 'billing',
    intendedAction: 'finalize stale idempotency and stuck billing operation rows through billing recovery services',
    example: 'npx tsx scripts/operator/billing/flush-stale-idempotency.ts --target-env=local --apply',
  });
  if (!safety.allowed) return 0;

  const flags = parseFlags(process.argv.slice(2));
  const actor = `system:cli-flush-${os.userInfo().username ?? 'unknown'}`;

  console.log('Flush Stale Idempotency');
  console.log(`  mode:     ${flags.dryRun ? 'DRY-RUN (no mutations)' : 'LIVE'}`);
  console.log(`  scope:    ${flags.scope ?? '(all)'}`);
  console.log(`  age-sec:  ${flags.ageSec ?? '(SLA windows)'}`);
  console.log(`  limit:    ${flags.limit}`);
  console.log(`  actor:    ${actor}`);
  console.log('');

  let hadError = false;

  // 1. Middleware bookkeeping rows (the 409 IDEMPOTENCY_IN_PROGRESS source)
  const midResult = await cleanStaleApiIdempotencyKeys({
    stuckWindowSec: flags.ageSec,
    limit:          flags.limit,
    dryRun:         flags.dryRun,
  });
  console.log('api_idempotency_keys:');
  console.log(`  scanned: ${midResult.scanned}`);
  console.log(`  cleaned: ${midResult.cleaned}`);
  console.log(`  errors:  ${midResult.errors}`);
  if (flags.scope) {
    const inScope = midResult.staleKeys.filter(k => k.scope === flags.scope);
    console.log(`  in scope "${flags.scope}": ${inScope.length}`);
    for (const k of inScope.slice(0, 20)) {
      console.log(`    - ${k.idempotency_key}  locked_at=${k.locked_at}`);
    }
  }
  if (midResult.errors > 0) hadError = true;

  // 2. Operational surfaces (billing_operations / job_execution_registry / approvals)
  const opResult = await reconcileStuckOperations(actor, {
    limitPerSurface: flags.limit,
    dryRun:          flags.dryRun,
    windowSecOverride: flags.ageSec
      ? { billing_operations: flags.ageSec, job_execution_registry: flags.ageSec }
      : undefined,
  });
  console.log('');
  console.log('operational surfaces:');
  console.log(`  scanned:           ${opResult.scanned}`);
  console.log(`  recovered:         ${opResult.recovered}`);
  console.log(`  refused (drift):   ${opResult.refusedDueToDrift}`);
  console.log(`  errors:            ${opResult.errors}`);
  if (opResult.refusedDueToDrift > 0) {
    console.log('  ⚠ Some operations were refused due to financial drift.');
    console.log('    The reaper must release dangling HOLDs before these can be recovered.');
    hadError = true;
  }
  if (opResult.errors > 0) hadError = true;

  console.log('');
  if (flags.dryRun) {
    console.log('DRY-RUN complete — nothing mutated.');
    return 0;
  }
  if (hadError) {
    console.log('Completed WITH issues — review drift refusals / errors above.');
    return 1;
  }
  console.log('OK — stale idempotency state flushed. No manual SQL required.');
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

export { main as flushStaleIdempotency };

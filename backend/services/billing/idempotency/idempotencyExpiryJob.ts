/**
 * Idempotency Expiry Job — Phase C + Stuck-Row Remediation B
 *
 * Cron-scheduled composite cleaner. Calls:
 *   1. reconcileStuckOperations — finalizes stuck billing_operations /
 *      job_execution_registry / credit_action_approvals rows
 *   2. cleanStaleApiIdempotencyKeys — finalizes stuck 'processing' rows in
 *      the `withIdempotency` middleware's `api_idempotency_keys` table
 *
 * Schedule: every 5 minutes recommended.
 * Run via `/api/cron/billing-idempotency-expire`.
 */

import { reconcileStuckOperations, type RecoverySummary, type StuckOperation } from './idempotencyRecoveryService';
import { cleanStaleApiIdempotencyKeys, type ApiIdempotencyCleanResult } from './apiIdempotencyKeyCleaner';

const SYSTEM_ACTOR = 'system:idempotency-expiry-cron';

export interface ExpiryJobOpts {
  windowSecOverride?: Partial<Record<StuckOperation['surface'], number>>;
  limitPerSurface?:   number;
  dryRun?:            boolean;
  /** Per-window override for the api_idempotency_keys table. Default 10 min. */
  apiIdempotencyKeyWindowSec?: number;
}

export interface ExpiryJobResult {
  operationalSurfaces: RecoverySummary;
  apiIdempotencyKeys:  ApiIdempotencyCleanResult;
}

export async function runIdempotencyExpiryJob(opts?: ExpiryJobOpts): Promise<ExpiryJobResult> {
  const operationalSurfaces = await reconcileStuckOperations(SYSTEM_ACTOR, {
    windowSecOverride: opts?.windowSecOverride,
    limitPerSurface:   opts?.limitPerSurface,
    dryRun:            opts?.dryRun,
  });

  const apiIdempotencyKeys = await cleanStaleApiIdempotencyKeys({
    stuckWindowSec: opts?.apiIdempotencyKeyWindowSec,
    limit:          opts?.limitPerSurface,
    dryRun:         opts?.dryRun,
  });

  return { operationalSurfaces, apiIdempotencyKeys };
}

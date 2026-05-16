/**
 * api_idempotency_keys Cleaner — Stuck-Row Remediation Phase B
 *
 * The `withIdempotency` middleware (backend/middleware/withIdempotency.ts)
 * tracks request-level idempotency in a separate table from the billing
 * surface. When a handler crashes between `createRecord('processing')` and
 * the `res.json()` capture, the row is left in `'processing'` forever,
 * causing subsequent requests with the SAME idempotency key to fail with
 * HTTP 409 `IDEMPOTENCY_IN_PROGRESS`.
 *
 * This is exactly the same lifecycle problem we already solved for
 * `billing_operations` — but it lives in a different table that the
 * orchestrator's finally block doesn't reach (because the middleware sits
 * OUTSIDE the orchestrator scope).
 *
 * This module reuses the same approach:
 *   - Find `'processing'` rows older than the SLA window (default 10 min).
 *   - Transition them to `'failed'` with `last_error` documenting the
 *     auto-expiry.
 *   - Emit anomaly + counter so ops sees the signal.
 *
 * Critical invariant: this NEVER touches the ledger. The middleware records
 * only request-hashes + captured responses — no financial state lives here.
 *
 * Wired into the existing `/api/cron/billing-idempotency-expire` cron via
 * `idempotencyExpiryJob.ts`.
 */

import { supabase } from '../../../db/supabaseClient';
import { ownedDbTable } from '../../../db/writeOwner';
import { logger } from '../../logger';
import { emitAnomaly } from '../billingAuditEmitter';
import { incrCounter } from '../billingMetrics';

const DEFAULT_STUCK_WINDOW_SEC = 10 * 60; // 10 minutes

export interface ApiIdempotencyCleanResult {
  scanned:    number;
  cleaned:    number;
  errors:     number;
  staleKeys:  Array<{ scope: string; idempotency_key: string; locked_at: string | null }>;
}

export async function cleanStaleApiIdempotencyKeys(opts?: {
  stuckWindowSec?: number;
  limit?:          number;
  dryRun?:         boolean;
}): Promise<ApiIdempotencyCleanResult> {
  const stuckWindowSec = opts?.stuckWindowSec ?? DEFAULT_STUCK_WINDOW_SEC;
  const limit          = opts?.limit ?? 200;
  const dryRun         = opts?.dryRun ?? false;
  const cutoff         = new Date(Date.now() - stuckWindowSec * 1000).toISOString();

  const result: ApiIdempotencyCleanResult = {
    scanned: 0, cleaned: 0, errors: 0, staleKeys: [],
  };

  // 1. Find stale 'processing' rows. Prefer `locked_at` (set when the row
  //    enters 'processing'); fall back to `updated_at` if `locked_at` is null.
  const { data, error } = await supabase
    .from('api_idempotency_keys')
    .select('id, scope, idempotency_key, locked_at, updated_at, request_id')
    .eq('status', 'processing')
    .or(`locked_at.lt.${cutoff},and(locked_at.is.null,updated_at.lt.${cutoff})`)
    .order('locked_at', { ascending: true, nullsFirst: true })
    .limit(limit);

  if (error) {
    logger.error('api_idempotency_clean_scan_failed', { message: error.message });
    return { scanned: 0, cleaned: 0, errors: 1, staleKeys: [] };
  }

  const rows = (data ?? []) as Array<{
    id: string;
    scope: string;
    idempotency_key: string;
    locked_at: string | null;
    updated_at: string | null;
    request_id: string | null;
  }>;
  result.scanned = rows.length;

  for (const row of rows) {
    result.staleKeys.push({
      scope:           row.scope,
      idempotency_key: row.idempotency_key,
      locked_at:       row.locked_at ?? row.updated_at,
    });

    if (dryRun) continue;

    // Transition the row to 'failed' with an audit-able last_error. The
    // update is guarded by status='processing' so we can't accidentally
    // overwrite a row that completed since the scan.
    try {
      const { data: updated, error: updErr } = await ownedDbTable('api_idempotency_keys')
        .update({
          status:       'failed',
          last_error:   'auto_expired_by_idempotency_cron',
          locked_at:    null,
          updated_at:   new Date().toISOString(),
        })
        .eq('id', row.id)
        .eq('status', 'processing')
        .select('id')
        .maybeSingle();

      if (updErr) {
        result.errors += 1;
        logger.warn('api_idempotency_clean_update_failed', {
          id: row.id, scope: row.scope, message: updErr.message,
        });
        continue;
      }
      if (!updated) {
        // Row transitioned to a terminal state between our scan and update.
        // Treat as already-clean; not an error.
        continue;
      }
      result.cleaned += 1;
    } catch (err: unknown) {
      result.errors += 1;
      logger.warn('api_idempotency_clean_threw', {
        id: row.id, message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (result.cleaned > 0 && !dryRun) {
    incrCounter('stale_operation_recovered_total', result.cleaned);
    incrCounter('idempotency_expired_total', result.cleaned);
    incrCounter('recovery_action_total', result.cleaned);
    emitAnomaly({
      kind: 'reservation_orphan_reaped',
      severity: result.cleaned > 50 ? 'critical' : 'warn',
      message: `api_idempotency_keys cleaner expired ${result.cleaned} stale 'processing' row(s)`,
      metadata: {
        scanned: result.scanned,
        cleaned: result.cleaned,
        errors:  result.errors,
        sample:  result.staleKeys.slice(0, 5),
      },
    });
  }

  logger.info('api_idempotency_clean_completed', {
    scanned: result.scanned,
    cleaned: result.cleaned,
    errors:  result.errors,
    dryRun,
  });

  return result;
}

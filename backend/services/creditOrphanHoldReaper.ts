/**
 * Credit Orphan-HOLD Reaper
 *
 * Releases credit_transactions rows whose `execution_phase = 'hold'` have
 * no matching `confirm` or `release` sibling AND are older than the
 * configured threshold. Without this reaper, a server crash between HOLD
 * and CONFIRM/RELEASE leaves the reserved_* balance permanently stuck —
 * the wallet appears smaller than it really is, the user is denied
 * future work, and no metric surfaces the leak.
 *
 * Sibling resolution:
 *   creditExecutionService writes three idempotency keys per work unit:
 *     `${baseKey}:hold`     — the HOLD row
 *     `${baseKey}:confirm`  — the CONFIRM row (success path)
 *     `${baseKey}:release`  — the RELEASE row (failure path)
 *   The sibling check derives `confirm` and `release` keys from the HOLD
 *   key and probes for either. If neither exists, the HOLD is orphaned.
 *
 * Release strategy:
 *   The reaper calls `apply_credit_reservation` with `phase='release'`,
 *   the original split, and the canonical `${baseKey}:release` key. This
 *   is exactly what executeWithCredits would have done on a successful
 *   exception path — fully idempotent. If a real release races the reaper
 *   and wins, the reaper's RPC returns the already-existing row.
 *
 * Safety invariants:
 *   - Only HOLDs older than `minAgeSeconds` are considered (default 1h).
 *   - Reaper is idempotent at the DB level via the RELEASE key.
 *   - Reaper records an audit row + logs structured telemetry per release.
 *   - Reaper batches and limits per run to avoid long-running locks.
 */

import { ownedDbTable } from '../db/writeOwner';
import { supabase } from '../db/supabaseClient';
import { logger } from './logger';
import { logSecurityEvent } from '../security/audit/SecurityAuditService';
import { callCreditReservation } from '../repositories/creditExecutionRepository';
import type { CategorySplit } from './creditPriorityService';

interface HoldRow {
  id: string;
  organization_id: string;
  free_delta: number | null;
  paid_delta: number | null;
  incentive_delta: number | null;
  idempotency_key: string;
  reference_type: string | null;
  reference_id: string | null;
  performed_by: string | null;
  created_at: string;
}

export interface ReapResult {
  scanned: number;
  released: number;
  skippedHasSibling: number;
  skippedTooYoung: number;
  failed: number;
  releasedHoldIds: string[];
}

const DEFAULT_MIN_AGE_SECONDS = 60 * 60;       // 1 hour
const DEFAULT_BATCH_LIMIT     = 200;
const DEFAULT_MAX_AGE_SECONDS = 60 * 60 * 24;  // 24 hours

export async function reapOrphanHolds(input?: {
  /** A HOLD must be at least this old to be eligible. Default: 1 hour. */
  minAgeSeconds?: number;
  /** Cap on rows scanned per run to bound DB load. Default: 200. */
  batchLimit?: number;
  /** Ignore HOLDs older than this — likely already paid by an alert path. Default: 24 hours. */
  maxAgeSeconds?: number;
  /** When set, restrict to this org. Useful for ops triage. */
  orgId?: string;
}): Promise<ReapResult> {
  const minAge = input?.minAgeSeconds ?? DEFAULT_MIN_AGE_SECONDS;
  const maxAge = input?.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;
  const limit  = input?.batchLimit    ?? DEFAULT_BATCH_LIMIT;

  const cutoffMin = new Date(Date.now() - minAge * 1000).toISOString();
  const cutoffMax = new Date(Date.now() - maxAge * 1000).toISOString();

  let query = ownedDbTable('credit_transactions')
    .select('id, organization_id, free_delta, paid_delta, incentive_delta, idempotency_key, reference_type, reference_id, performed_by, created_at')
    .eq('execution_phase', 'hold')
    .lt('created_at', cutoffMin)
    .gt('created_at', cutoffMax)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (input?.orgId) query = query.eq('organization_id', input.orgId);

  const { data: holds, error } = await query;
  if (error) {
    logger.error('orphan_hold_reaper_query_failed', { message: error.message });
    throw new Error(`orphan_hold_reaper_query_failed: ${error.message}`);
  }

  const result: ReapResult = {
    scanned:           (holds ?? []).length,
    released:          0,
    skippedHasSibling: 0,
    skippedTooYoung:   0,
    failed:            0,
    releasedHoldIds:   [],
  };

  for (const row of (holds ?? []) as HoldRow[]) {
    const baseKey = stripHoldSuffix(row.idempotency_key);
    if (!baseKey) {
      // Idempotency key didn't match the canonical `${baseKey}:hold` shape.
      // Could be a legacy hold from before the convention was enforced;
      // skip rather than risk releasing the wrong split.
      result.failed += 1;
      logger.warn('orphan_hold_reaper_unrecognized_key', {
        holdId: row.id,
        key:    row.idempotency_key,
      });
      continue;
    }

    const confirmKey = `${baseKey}:confirm`;
    const releaseKey = `${baseKey}:release`;

    const { data: siblings } = await ownedDbTable('credit_transactions')
      .select('id, execution_phase')
      .in('idempotency_key', [confirmKey, releaseKey])
      .limit(2);

    if (siblings && siblings.length > 0) {
      result.skippedHasSibling += 1;
      continue;
    }

    const split: CategorySplit = {
      free:      Math.abs(row.free_delta ?? 0),
      incentive: Math.abs(row.incentive_delta ?? 0),
      paid:      Math.abs(row.paid_delta ?? 0),
    };
    if (split.free === 0 && split.incentive === 0 && split.paid === 0) {
      // Zero-amount HOLD — nothing to release. Mark sibling so the row
      // is no longer scanned, by writing the canonical RELEASE row with
      // zero amounts. apply_credit_reservation handles zero deltas as
      // a no-op state update + ledger row.
    }

    const { error: rpcErr } = await callCreditReservation({
      orgId:          row.organization_id,
      phase:          'release',
      split,
      idempotencyKey: releaseKey,
      referenceType:  row.reference_type ?? 'orphan_hold',
      referenceId:    row.reference_id   ?? undefined,
      note:           `[REAPER] orphan HOLD released — original=${baseKey}`,
      performedBy:    row.performed_by   ?? row.organization_id,
      parentId:       row.id,
      // Determine category from the largest non-zero bucket so the audit
      // row reflects which wallet was reservation-locked.
      category:       split.paid >= split.free && split.paid >= split.incentive
        ? 'paid'
        : split.free >= split.incentive ? 'free' : 'incentive',
    });

    if (rpcErr) {
      result.failed += 1;
      logger.error('orphan_hold_reaper_release_failed', {
        holdId:  row.id,
        orgId:   row.organization_id,
        message: (rpcErr as { message?: string }).message,
      });
      continue;
    }

    result.released += 1;
    result.releasedHoldIds.push(row.id);

    void logSecurityEvent({
      capability:      'billing.audit.view',
      decision:        'session_revoked',
      actorUserId:     null,
      principalUserId: null,
      resourceId:      row.id,
      reason:          `orphan_hold_released org=${row.organization_id} key=${baseKey} free=${split.free} paid=${split.paid} incentive=${split.incentive}`,
    });
  }

  if (result.released > 0 || result.failed > 0) {
    logger.warn('orphan_hold_reaper_summary', { ...result });
  }

  return result;
}

function stripHoldSuffix(key: string | null | undefined): string | null {
  if (!key || typeof key !== 'string') return null;
  if (!key.endsWith(':hold')) return null;
  return key.slice(0, -':hold'.length);
}

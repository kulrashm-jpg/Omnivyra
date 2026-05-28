/**
 * Phase 22D — DistributedReclaimSafetyGovernor
 *
 * Pre-flight gate for every targeted dead-worker reclaim. Validates that
 * the proposed reclaim is safe BEFORE the queue/lease layer mutates state.
 *
 * VALIDATES (per spec):
 *   - execution ownership continuity   → execution exists + lease state consistent
 *   - lease ownership consistency       → claimed_by_worker matches lease.ownerWorkerId
 *   - replay idempotency state          → no concurrent ack racing with reclaim
 *   - queue replay continuity           → entry is still 'claimed' (not yet reclaimed elsewhere)
 *   - stale-worker confirmation         → worker is actually stale/offline, not transiently slow
 *   - reclaim race suppression          → no other reclaim attempt within suppression window
 *
 * PREVENTS:
 *   - reclaiming an actively-heartbeating execution
 *   - duplicate replay continuation triggered by parallel reclaim
 *   - split-brain recovery reclaim
 *   - unsafe ownership transfer
 *
 * TELEMETRY:
 *   reclaim_validation_succeeded
 *   reclaim_validation_failed
 *   reclaim_split_brain_prevented
 *
 * SCOPE: validation ONLY. Returns a verdict the caller acts on. NEVER
 * performs the actual reclaim — that's the caller's job (durable replay
 * coordinator).
 */

import type { DistributedExecutionQueue } from './distributedExecutionQueue';
import type { DistributedWorkerCoordinator } from './distributedWorkerCoordinator';
import type { LeaseRecoveryGovernor } from '@/backend/services/orchestration/recovery/leaseRecoveryGovernor';
import {
  getDefaultExecutionQueue,
} from './distributedExecutionQueue';
import {
  getDefaultDistributedWorkerCoordinator,
} from './distributedWorkerCoordinator';
import {
  getDefaultLeaseRecoveryGovernor,
} from '@/backend/services/orchestration/recovery/leaseRecoveryGovernor';
import type { QueueEntry, WorkerStatus } from './distributedTypes';

// ────────────────────────────────────────────────────────────────────
// Telemetry
// ────────────────────────────────────────────────────────────────────

export type ReclaimSafetyTelemetryEvent =
  | 'reclaim_validation_started'
  | 'reclaim_validation_succeeded'
  | 'reclaim_validation_failed'
  | 'reclaim_split_brain_prevented';

export interface ReclaimSafetyTelemetrySink {
  emit(event: ReclaimSafetyTelemetryEvent, payload: Record<string, unknown>): void;
}

const defaultTelemetrySink: ReclaimSafetyTelemetrySink = {
  emit(event, payload) {
    try {
      const line = JSON.stringify({ event, ...payload, ts: new Date().toISOString() });
      if (event === 'reclaim_split_brain_prevented' || event === 'reclaim_validation_failed') {
        console.warn(`[reclaim_safety] ${line}`);
      } else {
        console.log(`[reclaim_safety] ${line}`);
      }
    } catch { /* ignore */ }
  },
};

// ────────────────────────────────────────────────────────────────────
// Verdict shape
// ────────────────────────────────────────────────────────────────────

export type ReclaimVerdictReason =
  | 'queue_entry_not_claimed'
  | 'queue_entry_not_owned_by_target'
  | 'queue_entry_missing'
  | 'worker_still_alive'
  | 'lease_held_by_active_worker'
  | 'lease_inconsistent_with_claim'
  | 'reclaim_within_suppression_window'
  | 'reclaim_concurrent_attempt'
  | 'execution_missing';

export interface ReclaimSafetyVerdict {
  ok: boolean;
  reason: ReclaimVerdictReason | 'safe';
  detail: string;
  queueEntryId: string;
  targetWorkerId: string;
}

// ────────────────────────────────────────────────────────────────────
// Interface
// ────────────────────────────────────────────────────────────────────

export interface ValidateReclaimInput {
  queueEntryId: string;
  /** Worker the entry is currently claimed by (proposed reclaim target). */
  targetWorkerId: string;
  /** Caller-supplied stale window — only workers in stale/offline AND older than this are safe to reclaim. */
  staleConfirmationMs?: number;
  /** Suppression window — same entry can't be re-validated within this many ms. */
  suppressionWindowMs?: number;
  nowMs?: number;
}

export interface DistributedReclaimSafetyGovernor {
  /**
   * Validate that the proposed reclaim is safe. Returns a verdict the
   * caller (typically the durable replay coordinator) acts on.
   */
  validateReclaim(input: ValidateReclaimInput): Promise<ReclaimSafetyVerdict>;
  /** Test helper: clear suppression history. */
  _reset(): void;
}

// ────────────────────────────────────────────────────────────────────
// Implementation
// ────────────────────────────────────────────────────────────────────

export interface DistributedReclaimSafetyGovernorOptions {
  queue?: DistributedExecutionQueue;
  workerCoordinator?: DistributedWorkerCoordinator;
  leaseRecoveryGovernor?: LeaseRecoveryGovernor;
  telemetry?: ReclaimSafetyTelemetrySink;
  /** Default stale confirmation window (ms). Default 30_000. */
  defaultStaleConfirmationMs?: number;
  /** Default suppression window (ms). Default 5_000. */
  defaultSuppressionWindowMs?: number;
}

export function createDistributedReclaimSafetyGovernor(
  options?: DistributedReclaimSafetyGovernorOptions,
): DistributedReclaimSafetyGovernor {
  const queue = options?.queue ?? getDefaultExecutionQueue();
  const workerCoord = options?.workerCoordinator ?? getDefaultDistributedWorkerCoordinator();
  const leaseGov = options?.leaseRecoveryGovernor ?? getDefaultLeaseRecoveryGovernor();
  const telemetry = options?.telemetry ?? defaultTelemetrySink;
  const defaultStaleMs = options?.defaultStaleConfirmationMs ?? 30_000;
  const defaultSuppressionMs = options?.defaultSuppressionWindowMs ?? 5_000;
  // Per-(queueEntry,worker) suppression history.
  const suppressionHistory = new Map<string, number>();

  function suppressionKey(input: ValidateReclaimInput): string {
    return `${input.queueEntryId}:${input.targetWorkerId}`;
  }

  function verdict(
    ok: boolean,
    reason: ReclaimVerdictReason | 'safe',
    detail: string,
    input: ValidateReclaimInput,
  ): ReclaimSafetyVerdict {
    return {
      ok, reason, detail,
      queueEntryId: input.queueEntryId,
      targetWorkerId: input.targetWorkerId,
    };
  }

  return {
    async validateReclaim(input) {
      const nowMs = input.nowMs ?? Date.now();
      const staleMs = input.staleConfirmationMs ?? defaultStaleMs;
      const suppressionMs = input.suppressionWindowMs ?? defaultSuppressionMs;
      const key = suppressionKey(input);

      telemetry.emit('reclaim_validation_started', {
        queueEntryId: input.queueEntryId,
        targetWorkerId: input.targetWorkerId,
      });

      // 1. Suppression window check.
      const lastTs = suppressionHistory.get(key);
      if (lastTs !== undefined && nowMs - lastTs < suppressionMs) {
        const v = verdict(false, 'reclaim_within_suppression_window',
          `last validation ${nowMs - lastTs}ms ago (< ${suppressionMs}ms window)`, input);
        telemetry.emit('reclaim_validation_failed', {
          queueEntryId: input.queueEntryId,
          targetWorkerId: input.targetWorkerId,
          reason: v.reason, detail: v.detail,
        });
        return v;
      }

      // Record this validation attempt for the suppression window.
      suppressionHistory.set(key, nowMs);

      // 2. Queue entry exists + still claimed.
      const entry: QueueEntry | null = await queue.get(input.queueEntryId);
      if (!entry) {
        const v = verdict(false, 'queue_entry_missing', 'queue entry not found', input);
        telemetry.emit('reclaim_validation_failed', { ...v });
        return v;
      }
      if (entry.status !== 'claimed') {
        // Already reclaimed / completed / dead-lettered — concurrent operation.
        const v = verdict(false, 'queue_entry_not_claimed',
          `entry status='${entry.status}' (expected 'claimed')`, input);
        telemetry.emit('reclaim_validation_failed', { ...v });
        return v;
      }
      if (entry.claimedByWorkerId !== input.targetWorkerId) {
        // Another worker holds the claim — possible split-brain.
        const v = verdict(false, 'queue_entry_not_owned_by_target',
          `claimedBy='${entry.claimedByWorkerId}' (expected '${input.targetWorkerId}')`, input);
        telemetry.emit('reclaim_split_brain_prevented', {
          ...v, actualOwner: entry.claimedByWorkerId,
        });
        telemetry.emit('reclaim_validation_failed', { ...v });
        return v;
      }

      // 3. Stale-worker confirmation.
      const targetWorker = await workerCoord.get(input.targetWorkerId);
      if (targetWorker) {
        const isStaleOrOffline =
          targetWorker.status === 'stale' || targetWorker.status === 'offline';
        if (!isStaleOrOffline) {
          // Worker is still active / draining — refuse to reclaim.
          const v = verdict(false, 'worker_still_alive',
            `target worker status='${targetWorker.status}'`, input);
          telemetry.emit('reclaim_validation_failed', { ...v });
          return v;
        }
        // Additionally check the heartbeat age — worker might be marked
        // stale but actually fresh if its last heartbeat is recent.
        if (targetWorker.heartbeatAtIso) {
          const ageMs = nowMs - Date.parse(targetWorker.heartbeatAtIso);
          if (ageMs < staleMs) {
            const v = verdict(false, 'worker_still_alive',
              `worker heartbeat ${ageMs}ms ago < ${staleMs}ms stale window`, input);
            telemetry.emit('reclaim_validation_failed', { ...v });
            return v;
          }
        }
      }
      // If worker is unknown (purged from registry), proceed — that's the
      // strongest "dead worker" signal we have.

      // 4. Lease consistency check.
      const eligibility = await leaseGov.assessRecoveryEligibility({
        executionId: entry.executionId, nowMs,
      });
      if (eligibility.eligibility === 'ineligible_execution_missing') {
        const v = verdict(false, 'execution_missing',
          'execution row not found', input);
        telemetry.emit('reclaim_validation_failed', { ...v });
        return v;
      }
      if (eligibility.eligibility === 'ineligible_live_lease') {
        // A live lease is held by some worker. If that worker is the
        // (now-dead) target, the lease is stale and we should still treat
        // it as eligible — but the eligibility report says otherwise.
        // Be conservative: if the lease owner is NOT the dead target,
        // refuse the reclaim.
        if (eligibility.currentOwnerWorkerId !== input.targetWorkerId) {
          const v = verdict(false, 'lease_held_by_active_worker',
            `lease owned by '${eligibility.currentOwnerWorkerId}'`, input);
          telemetry.emit('reclaim_split_brain_prevented', { ...v });
          telemetry.emit('reclaim_validation_failed', { ...v });
          return v;
        }
        // Lease owned by the target dead worker — that's actually OK
        // (lease will be released by recovery coordinator on the next
        // takeover). Fall through to success.
      }
      // Lease cross-check: claimed_by_worker should match lease.ownerWorkerId
      // (when the lease is held). If they diverge, something's inconsistent.
      if (eligibility.currentOwnerWorkerId &&
          eligibility.currentOwnerWorkerId !== entry.claimedByWorkerId) {
        const v = verdict(false, 'lease_inconsistent_with_claim',
          `lease owner '${eligibility.currentOwnerWorkerId}' != claim owner '${entry.claimedByWorkerId}'`, input);
        telemetry.emit('reclaim_validation_failed', { ...v });
        return v;
      }

      // 5. All clear.
      const v = verdict(true, 'safe', 'all reclaim safety checks passed', input);
      telemetry.emit('reclaim_validation_succeeded', { ...v });
      return v;
    },

    _reset() {
      suppressionHistory.clear();
    },
  };
}

let _default: DistributedReclaimSafetyGovernor | null = null;
export function getDefaultDistributedReclaimSafetyGovernor(): DistributedReclaimSafetyGovernor {
  if (!_default) _default = createDistributedReclaimSafetyGovernor();
  return _default;
}
export function setDefaultDistributedReclaimSafetyGovernor(g: DistributedReclaimSafetyGovernor): void {
  _default = g;
}

// Helper re-export for tests
export type { WorkerStatus };

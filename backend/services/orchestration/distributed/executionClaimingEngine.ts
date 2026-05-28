/**
 * Phase 20C — ExecutionClaimingEngine (Phase 21C hardened)
 *
 * Atomically transfers ownership of an execution from a queue claim to
 * a specific worker. Combines:
 *   - DistributedExecutionQueue.claim() (visibility-timeout entry)
 *   - LeaseRecoveryGovernor.takeoverForRecovery() (durable lease takeover)
 *   - DurableExecutionCoordinator (lifecycle ground truth)
 *   - DistributedWorkerCoordinator (worker eligibility)
 *
 * PHASE 21C — DURABLE QUEUE HARDENING
 *   This engine is interface-agnostic: it works identically against the
 *   in-memory queue (Phase 20A) AND the SupabaseExecutionQueue (Phase 21A).
 *   Both implementations enforce atomic claim at the QUEUE LAYER:
 *     - InMemory: synchronous Map mutation; race-free within a process.
 *     - Supabase: partial unique index `uniq_thread_runtime_queue_live_dedup`
 *       + conditional UPDATE ... WHERE queue_status=? guarantees that two
 *       writers racing on the same row yield exactly one winner; the loser
 *       sees data=[] and skips to the next candidate.
 *   The lease takeover step provides DEFENSE IN DEPTH on top of the
 *   queue's atomicity: even if a queue claim were to leak across instances,
 *   the lease store's partial unique index `uniq_thread_runtime_leases_active`
 *   would refuse the second lease.
 *
 *   "Duplicate replay continuation" is suppressed by the idempotency
 *   governor (Phase 19E), which is consulted inside the replay continuation
 *   engine — NOT here. This engine's job is single-canonical-owner only.
 *
 * The combination enforces the single-canonical-owner invariant: at any
 * point in time, exactly one worker may run an execution. This is the
 * bridge between the queue (which is a coordination layer) and the
 * durable execution state (which is the system of record).
 *
 * CAPABILITIES (per spec):
 *   - atomic execution claim
 *   - ownership transfer
 *   - lease-aware claim validation
 *   - stale execution reclaim
 *   - duplicate claim suppression
 *   - visibility-timeout reclaim
 *
 * GUARANTEES:
 *   - Single canonical owner: claim() succeeds for AT MOST ONE worker per
 *     queue entry per visibility window. The underlying queue entry is
 *     atomically marked 'claimed'; the lease store enforces a separate
 *     unique-live-lease invariant on the executionId.
 *   - Split-brain suppression: if the queue claim succeeds but the lease
 *     takeover fails (because another live lease exists), the queue
 *     entry is released back so a future claim can re-attempt.
 *   - Duplicate claim suppression: a worker re-calling claim() with the
 *     same queue entry id returns the existing claim (idempotent).
 *   - Worker eligibility: workers not in 'active' status are refused.
 */

import {
  getDefaultExecutionQueue,
  type DistributedExecutionQueue,
} from './distributedExecutionQueue';
import {
  getDefaultDistributedWorkerCoordinator,
  type DistributedWorkerCoordinator,
} from './distributedWorkerCoordinator';
import {
  getDefaultLeaseRecoveryGovernor,
  type LeaseRecoveryGovernor,
} from '@/backend/services/orchestration/recovery/leaseRecoveryGovernor';
import {
  getDefaultDurableExecutionCoordinator,
  type DurableExecutionCoordinator,
} from '@/backend/services/threadRuntime/durableExecutionCoordinator';
import type {
  ClaimOwnershipOutcome,
  QueueEntry,
  QueueEntryKind,
} from './distributedTypes';

// ────────────────────────────────────────────────────────────────────
// Telemetry
// ────────────────────────────────────────────────────────────────────

export type ClaimingTelemetryEvent =
  | 'ownership_claim_started'
  | 'ownership_claim_succeeded'
  | 'ownership_claim_refused'
  | 'ownership_transfer_succeeded'
  | 'ownership_release_attempted';

export interface ClaimingTelemetrySink {
  emit(event: ClaimingTelemetryEvent, payload: Record<string, unknown>): void;
}

const defaultTelemetrySink: ClaimingTelemetrySink = {
  emit(event, payload) {
    try {
      const line = JSON.stringify({ event, ...payload, ts: new Date().toISOString() });
      if (event === 'ownership_claim_refused') console.warn(`[claim_engine] ${line}`);
      else console.log(`[claim_engine] ${line}`);
    } catch { /* ignore */ }
  },
};

// ────────────────────────────────────────────────────────────────────
// Interface
// ────────────────────────────────────────────────────────────────────

export interface ClaimNextInput {
  workerId: string;
  visibilityMs?: number;
  /** Lease takeover duration. Default 60_000. */
  leaseDurationMs?: number;
  kind?: QueueEntryKind;
  companyId?: string;
  nowMs?: number;
}

export interface ClaimNextResult {
  queueEntry: QueueEntry;
  ownership: ClaimOwnershipOutcome;
}

export interface ExecutionClaimingEngine {
  /**
   * Claim the next eligible queue entry AND acquire its execution lease.
   * Returns null when no entry is eligible. The queue entry is released
   * (visibility expired) if lease takeover fails so a follow-on call
   * can retry.
   */
  claimNext(input: ClaimNextInput): Promise<ClaimNextResult | null>;
  /** Release a claim explicitly (releases lease + acks queue entry as failed). */
  releaseClaim(input: {
    queueEntryId: string;
    workerId: string;
    leaseId?: string | null;
    reason?: string;
  }): Promise<void>;
}

// ────────────────────────────────────────────────────────────────────
// Implementation
// ────────────────────────────────────────────────────────────────────

export interface ExecutionClaimingEngineOptions {
  queue?: DistributedExecutionQueue;
  workerCoordinator?: DistributedWorkerCoordinator;
  leaseGovernor?: LeaseRecoveryGovernor;
  durableExecution?: DurableExecutionCoordinator;
  telemetry?: ClaimingTelemetrySink;
  defaultLeaseDurationMs?: number;
  defaultVisibilityMs?: number;
}

export function createExecutionClaimingEngine(
  options?: ExecutionClaimingEngineOptions,
): ExecutionClaimingEngine {
  const queue = options?.queue ?? getDefaultExecutionQueue();
  const workerCoord = options?.workerCoordinator ?? getDefaultDistributedWorkerCoordinator();
  const leaseGovernor = options?.leaseGovernor ?? getDefaultLeaseRecoveryGovernor();
  const durable = options?.durableExecution ?? getDefaultDurableExecutionCoordinator();
  const telemetry = options?.telemetry ?? defaultTelemetrySink;
  const defaultLeaseDur = options?.defaultLeaseDurationMs ?? 60_000;
  const defaultVisibility = options?.defaultVisibilityMs ?? 60_000;

  return {
    async claimNext(input) {
      const nowMs = input.nowMs ?? Date.now();
      telemetry.emit('ownership_claim_started', {
        workerId: input.workerId, kind: input.kind ?? null, companyId: input.companyId ?? null,
      });

      // Step 1 — worker eligibility check.
      const worker = await workerCoord.get(input.workerId);
      if (!worker || worker.status !== 'active') {
        telemetry.emit('ownership_claim_refused', {
          workerId: input.workerId,
          reason: 'worker_ineligible',
          workerStatus: worker?.status ?? 'unknown',
        });
        return null;
      }

      // Step 2 — claim a queue entry (visibility timeout enforced atomically).
      const claimed = await queue.claim({
        workerId: input.workerId,
        visibilityMs: input.visibilityMs ?? defaultVisibility,
        kind: input.kind, companyId: input.companyId,
        nowMs, limit: 1,
      });
      if (claimed.length === 0) {
        return null;
      }
      const entry = claimed[0];

      // Step 3 — verify the execution exists.
      const execRecord = await durable.get(entry.executionId);
      if (!execRecord) {
        telemetry.emit('ownership_claim_refused', {
          workerId: input.workerId, queueEntryId: entry.queueEntryId,
          reason: 'execution_missing',
        });
        // Release the queue entry — execution disappeared.
        await queue.ack({
          queueEntryId: entry.queueEntryId, workerId: input.workerId,
          outcome: 'failed', failureReason: 'execution_missing',
        });
        return {
          queueEntry: entry,
          ownership: { ok: false, reason: 'execution_missing' },
        };
      }

      // Step 4 — atomic lease takeover via the recovery governor.
      // This pairs with the queue claim to enforce single-canonical-owner.
      const leaseOutcome = await leaseGovernor.takeoverForRecovery({
        executionId: entry.executionId,
        workerId: input.workerId,
        durationMs: input.leaseDurationMs ?? defaultLeaseDur,
        nowMs,
      });

      if (leaseOutcome.action === 'takeover_refused' || leaseOutcome.action === 'failed') {
        // Split-brain prevention: another worker holds the live lease.
        // Release our queue claim immediately so the lease holder can finish.
        await queue.retry({
          queueEntryId: entry.queueEntryId,
          reason: `lease_takeover_refused: ${leaseOutcome.reason}`,
        });
        telemetry.emit('ownership_claim_refused', {
          workerId: input.workerId, queueEntryId: entry.queueEntryId,
          executionId: entry.executionId,
          reason: 'lease_takeover_refused',
          leaseReason: leaseOutcome.reason,
        });
        return {
          queueEntry: entry,
          ownership: { ok: false, reason: 'lease_takeover_refused' },
        };
      }

      // Step 5 — note worker activity counter.
      await workerCoord.noteExecutionStarted(input.workerId);

      // Determine previous owner for forensics.
      const previousOwnerId = leaseOutcome.reason.startsWith('took over from ')
        ? leaseOutcome.reason.slice('took over from '.length)
        : null;

      telemetry.emit('ownership_claim_succeeded', {
        workerId: input.workerId, queueEntryId: entry.queueEntryId,
        executionId: entry.executionId,
        leaseId: leaseOutcome.newLeaseId,
        previousOwnerId,
      });
      if (previousOwnerId) {
        telemetry.emit('ownership_transfer_succeeded', {
          executionId: entry.executionId,
          previousOwnerId, newOwnerId: input.workerId,
          atIso: new Date(nowMs).toISOString(),
          reason: leaseOutcome.reason,
        });
      }

      return {
        queueEntry: entry,
        ownership: {
          ok: true,
          execution: execRecord,
          workerId: input.workerId,
          previousOwnerId,
        },
      };
    },

    async releaseClaim(input) {
      telemetry.emit('ownership_release_attempted', {
        workerId: input.workerId, queueEntryId: input.queueEntryId,
        reason: input.reason ?? 'explicit_release',
      });
      // Release the lease first so a follow-on worker can claim quickly.
      if (input.leaseId) {
        await leaseGovernor.releaseLease(input.leaseId);
      }
      // Ack the queue entry as failed so the retry policy kicks in.
      await queue.ack({
        queueEntryId: input.queueEntryId,
        workerId: input.workerId,
        outcome: 'failed',
        failureReason: input.reason ?? 'explicit_release',
      });
      // Decrement worker's active execution counter.
      await workerCoord.noteExecutionFinished(input.workerId);
    },
  };
}

// ────────────────────────────────────────────────────────────────────
// Default singleton
// ────────────────────────────────────────────────────────────────────

let _default: ExecutionClaimingEngine | null = null;
export function getDefaultExecutionClaimingEngine(): ExecutionClaimingEngine {
  if (!_default) _default = createExecutionClaimingEngine();
  return _default;
}
export function setDefaultExecutionClaimingEngine(e: ExecutionClaimingEngine): void {
  _default = e;
}

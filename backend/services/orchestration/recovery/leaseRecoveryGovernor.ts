/**
 * Phase 19F — LeaseRecoveryGovernor
 *
 * Recovery-specific wrapper around the existing ExecutionLeaseGovernor +
 * underlying store. Provides:
 *
 *   - sweepExpiredLeases()       — bulk cleanup of stale leases
 *   - assessRecoveryEligibility()— per-execution eligibility check
 *   - takeoverForRecovery()      — atomic takeover with conflict suppression
 *   - reconcileStaleHeartbeat()  — heartbeat-only reconciliation (no claim)
 *
 * Atomicity is delegated to the underlying lease store's partial unique
 * index (see migration 20260808). This module enforces:
 *   - DETERMINISTIC takeover rules: a takeover may only happen when the
 *     current lease is released OR expired at the supplied nowMs.
 *   - NO DOUBLE OWNERSHIP: a takeover that races a live-lease holder
 *     surfaces as { action: 'takeover_refused' }.
 *   - SPLIT-BRAIN SUPPRESSION: callers see the previous owner in the
 *     outcome and can verify before mutating state.
 *
 * SCOPE: lease lifecycle ONLY. No orchestration semantics, no replay,
 * no autonomous loops. Caller-driven sweep + takeover.
 */

import {
  getDefaultExecutionStore,
  type ExecutionStore,
} from '@/backend/services/threadRuntime/executionStore';
import {
  getDefaultExecutionLeaseGovernor,
  type ExecutionLeaseGovernor,
} from '@/backend/services/threadRuntime/executionLeaseGovernor';
import type {
  LeaseRecoveryAction,
  LeaseRecoveryOutcome,
} from './recoveryTypes';

// ── Telemetry ────────────────────────────────────────────────────────

export type LeaseRecoveryTelemetryEvent =
  | 'lease_recovery_attempt'
  | 'lease_recovery_success'
  | 'lease_recovery_failure';

export interface LeaseRecoveryTelemetrySink {
  emit(event: LeaseRecoveryTelemetryEvent, payload: Record<string, unknown>): void;
}

const defaultTelemetrySink: LeaseRecoveryTelemetrySink = {
  emit(event, payload) {
    try {
      const line = JSON.stringify({ event, ...payload, ts: new Date().toISOString() });
      if (event === 'lease_recovery_failure') console.warn(`[lease_recovery] ${line}`);
      else console.log(`[lease_recovery] ${line}`);
    } catch { /* ignore */ }
  },
};

// ── Eligibility ─────────────────────────────────────────────────────

export type RecoveryEligibility =
  | 'eligible_no_lease'
  | 'eligible_expired_lease'
  | 'eligible_released_lease'
  | 'ineligible_live_lease'
  | 'ineligible_execution_missing';

export interface RecoveryEligibilityReport {
  executionId: string;
  eligibility: RecoveryEligibility;
  currentOwnerWorkerId: string | null;
  currentLeaseExpiresAtIso: string | null;
  staleAgeMs: number;
}

// ── Governor ────────────────────────────────────────────────────────

export interface LeaseRecoveryGovernorOptions {
  store?: ExecutionStore;
  leaseGovernor?: ExecutionLeaseGovernor;
  telemetry?: LeaseRecoveryTelemetrySink;
  /** Default lease duration for takeover claims (ms). Default 60_000. */
  defaultLeaseDurationMs?: number;
  /** Default heartbeat-stale threshold for reconcileStaleHeartbeat. Default 90_000. */
  defaultHeartbeatStaleMs?: number;
}

export interface LeaseRecoveryGovernor {
  sweepExpiredLeases(input?: { nowMs?: number; limit?: number }): Promise<{ releasedLeaseIds: string[] }>;
  assessRecoveryEligibility(input: {
    executionId: string;
    nowMs?: number;
  }): Promise<RecoveryEligibilityReport>;
  takeoverForRecovery(input: {
    executionId: string;
    workerId: string;
    durationMs?: number;
    nowMs?: number;
  }): Promise<LeaseRecoveryOutcome>;
  reconcileStaleHeartbeat(input: {
    executionId: string;
    nowMs?: number;
    staleThresholdMs?: number;
  }): Promise<{ stale: boolean; lastHeartbeatIso: string | null; staleAgeMs: number }>;
  /** Release a specific lease. Used by the recovery coordinator after an attempt. */
  releaseLease(leaseId: string): Promise<void>;
}

export function createLeaseRecoveryGovernor(options?: LeaseRecoveryGovernorOptions): LeaseRecoveryGovernor {
  const store = options?.store ?? getDefaultExecutionStore();
  const leaseGovernor = options?.leaseGovernor ?? getDefaultExecutionLeaseGovernor();
  const telemetry = options?.telemetry ?? defaultTelemetrySink;
  const defaultLeaseDur = options?.defaultLeaseDurationMs ?? 60_000;
  const defaultStaleMs = options?.defaultHeartbeatStaleMs ?? 90_000;

  return {
    async sweepExpiredLeases(input) {
      const nowMs = input?.nowMs ?? Date.now();
      const limit = input?.limit ?? 100;
      telemetry.emit('lease_recovery_attempt', { operation: 'sweep', nowMs, limit });
      try {
        const releasedLeaseIds = await leaseGovernor.sweepExpired({ nowMs, limit });
        telemetry.emit('lease_recovery_success', {
          operation: 'sweep', releasedCount: releasedLeaseIds.length,
          releasedLeaseIds, nowMs,
        });
        return { releasedLeaseIds };
      } catch (err) {
        const msg = (err as Error)?.message ?? 'unknown sweep error';
        telemetry.emit('lease_recovery_failure', { operation: 'sweep', error: msg });
        throw err;
      }
    },

    async assessRecoveryEligibility(input) {
      const nowMs = input.nowMs ?? Date.now();
      const exec = await store.getExecution(input.executionId);
      if (!exec) {
        return {
          executionId: input.executionId,
          eligibility: 'ineligible_execution_missing',
          currentOwnerWorkerId: null,
          currentLeaseExpiresAtIso: null,
          staleAgeMs: 0,
        };
      }
      const cur = await store.currentLease(input.executionId);
      if (!cur) {
        return {
          executionId: input.executionId,
          eligibility: 'eligible_no_lease',
          currentOwnerWorkerId: null,
          currentLeaseExpiresAtIso: null,
          staleAgeMs: 0,
        };
      }
      if (cur.released) {
        return {
          executionId: input.executionId,
          eligibility: 'eligible_released_lease',
          currentOwnerWorkerId: cur.ownerWorkerId,
          currentLeaseExpiresAtIso: cur.expiresAt,
          staleAgeMs: Math.max(0, nowMs - Date.parse(cur.expiresAt)),
        };
      }
      const expiresMs = Date.parse(cur.expiresAt);
      if (Number.isFinite(expiresMs) && expiresMs <= nowMs) {
        return {
          executionId: input.executionId,
          eligibility: 'eligible_expired_lease',
          currentOwnerWorkerId: cur.ownerWorkerId,
          currentLeaseExpiresAtIso: cur.expiresAt,
          staleAgeMs: Math.max(0, nowMs - expiresMs),
        };
      }
      return {
        executionId: input.executionId,
        eligibility: 'ineligible_live_lease',
        currentOwnerWorkerId: cur.ownerWorkerId,
        currentLeaseExpiresAtIso: cur.expiresAt,
        staleAgeMs: 0,
      };
    },

    async takeoverForRecovery(input) {
      const nowMs = input.nowMs ?? Date.now();
      const durationMs = input.durationMs ?? defaultLeaseDur;
      telemetry.emit('lease_recovery_attempt', {
        operation: 'takeover',
        executionId: input.executionId,
        workerId: input.workerId,
        nowMs,
      });

      // Eligibility check first — refuses takeover against a live lease.
      const eligibility = await this.assessRecoveryEligibility({ executionId: input.executionId, nowMs });
      if (eligibility.eligibility === 'ineligible_execution_missing') {
        const outcome: LeaseRecoveryOutcome = {
          executionId: input.executionId,
          action: 'failed',
          releasedLeaseIds: [],
          takeoverWorkerId: null,
          newLeaseId: null,
          reason: 'execution_not_found',
        };
        telemetry.emit('lease_recovery_failure', { ...outcome });
        return outcome;
      }
      if (eligibility.eligibility === 'ineligible_live_lease') {
        const outcome: LeaseRecoveryOutcome = {
          executionId: input.executionId,
          action: 'takeover_refused',
          releasedLeaseIds: [],
          takeoverWorkerId: null,
          newLeaseId: null,
          reason: `live lease held by ${eligibility.currentOwnerWorkerId}`,
        };
        telemetry.emit('lease_recovery_failure', { ...outcome });
        return outcome;
      }

      const claim = await leaseGovernor.claimWithTakeover({
        executionId: input.executionId,
        workerId: input.workerId,
        durationMs,
        nowMs,
      });
      if (claim.ok === false) {
        const outcome: LeaseRecoveryOutcome = {
          executionId: input.executionId,
          action: 'takeover_refused',
          releasedLeaseIds: [],
          takeoverWorkerId: null,
          newLeaseId: null,
          reason: claim.reason,
        };
        telemetry.emit('lease_recovery_failure', { ...outcome });
        return outcome;
      }

      const action: LeaseRecoveryAction = claim.tookOverFrom ? 'took_over' : 'cleaned_expired';
      const outcome: LeaseRecoveryOutcome = {
        executionId: input.executionId,
        action,
        releasedLeaseIds: [], // store-level release is opaque; track at sweep
        takeoverWorkerId: input.workerId,
        newLeaseId: claim.lease.leaseId,
        reason: claim.tookOverFrom
          ? `took over from ${claim.tookOverFrom}`
          : 'no prior owner',
      };
      telemetry.emit('lease_recovery_success', { ...outcome });
      return outcome;
    },

    async releaseLease(leaseId) {
      if (!leaseId) return;
      try {
        await leaseGovernor.release(leaseId);
      } catch (err) {
        telemetry.emit('lease_recovery_failure', {
          operation: 'releaseLease', leaseId,
          error: (err as Error)?.message ?? String(err),
        });
      }
    },

    async reconcileStaleHeartbeat(input) {
      const nowMs = input.nowMs ?? Date.now();
      const threshold = input.staleThresholdMs ?? defaultStaleMs;
      const exec = await store.getExecution(input.executionId);
      if (!exec) {
        return { stale: false, lastHeartbeatIso: null, staleAgeMs: 0 };
      }
      if (!exec.heartbeatAt) {
        return { stale: true, lastHeartbeatIso: null, staleAgeMs: nowMs - Date.parse(exec.startedAt) };
      }
      const ageMs = Math.max(0, nowMs - Date.parse(exec.heartbeatAt));
      return {
        stale: ageMs > threshold,
        lastHeartbeatIso: exec.heartbeatAt,
        staleAgeMs: ageMs,
      };
    },
  };
}

let _default: LeaseRecoveryGovernor | null = null;
export function getDefaultLeaseRecoveryGovernor(): LeaseRecoveryGovernor {
  if (!_default) _default = createLeaseRecoveryGovernor();
  return _default;
}
export function setDefaultLeaseRecoveryGovernor(g: LeaseRecoveryGovernor): void {
  _default = g;
}

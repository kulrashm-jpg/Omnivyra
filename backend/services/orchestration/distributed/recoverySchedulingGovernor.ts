/**
 * Phase 20E — RecoverySchedulingGovernor
 *
 * Bounded scheduler for recovery enqueueing. Sits between the
 * StaleExecutionReconciler (which surfaces findings) and the
 * DistributedExecutionQueue (which actually carries the work).
 *
 * CAPABILITIES (per spec):
 *   - bounded recovery throughput
 *   - stale execution prioritization
 *   - recovery backoff
 *   - recovery concurrency limits
 *   - recovery storm suppression
 *   - deterministic recovery ordering
 *
 * SCOPE: scheduling decisions ONLY. No queue introspection beyond depth.
 * No autonomous orchestration. Caller invokes `scheduleStaleRecoveries`;
 * governor decides which findings to enqueue + with what backoff.
 *
 * GUARANTEES:
 *   - Bounded: per-call cap (`maxSchedulePerCall`, default 25).
 *   - No storms: an execution that was scheduled within the
 *     suppressionWindowMs is suppressed (prevents re-enqueue floods).
 *   - Backoff escalates by attempt count: 5s, 15s, 60s, ... capped.
 *   - Deterministic ordering: stale_age DESC, executionId ASC (so
 *     longest-stale wins ties).
 */

import type {
  StaleExecutionFinding,
} from '@/backend/services/orchestration/recovery/recoveryTypes';
import {
  getDefaultExecutionQueue,
  type DistributedExecutionQueue,
} from './distributedExecutionQueue';
import type {
  RecoverySchedulingDecision,
  RecoverySchedulingReport,
} from './distributedTypes';

// ────────────────────────────────────────────────────────────────────
// Telemetry
// ────────────────────────────────────────────────────────────────────

export type RecoverySchedulingTelemetryEvent =
  | 'recovery_scheduling_pressure'
  | 'recovery_scheduled'
  | 'recovery_throttled'
  | 'recovery_suppressed';

export interface RecoverySchedulingTelemetrySink {
  emit(event: RecoverySchedulingTelemetryEvent, payload: Record<string, unknown>): void;
}

const defaultTelemetrySink: RecoverySchedulingTelemetrySink = {
  emit(event, payload) {
    try {
      const line = JSON.stringify({ event, ...payload, ts: new Date().toISOString() });
      if (event === 'recovery_scheduling_pressure') console.warn(`[recovery_sched] ${line}`);
      else console.log(`[recovery_sched] ${line}`);
    } catch { /* ignore */ }
  },
};

// ────────────────────────────────────────────────────────────────────
// Interface
// ────────────────────────────────────────────────────────────────────

export interface ScheduleStaleRecoveriesInput {
  findings: StaleExecutionFinding[];
  /** Max recoveries to schedule in this call. Default 25. */
  maxSchedulePerCall?: number;
  /** Max recoveries queued concurrently. Schedules above this are throttled. Default 50. */
  maxConcurrentInFlight?: number;
  /** Suppression window: re-suppress same exec scheduled within this many ms. Default 60_000. */
  suppressionWindowMs?: number;
  /** Optional company scoping for queue depth check. */
  companyId?: string;
  nowMs?: number;
}

export interface RecoverySchedulingGovernor {
  scheduleStaleRecoveries(input: ScheduleStaleRecoveriesInput): Promise<RecoverySchedulingReport>;
  /** Test helper: zero the suppression history. */
  _resetHistory(): void;
}

// ────────────────────────────────────────────────────────────────────
// Implementation
// ────────────────────────────────────────────────────────────────────

export interface RecoverySchedulingGovernorOptions {
  queue?: DistributedExecutionQueue;
  telemetry?: RecoverySchedulingTelemetrySink;
}

function computeBackoffMs(attempt: number): number {
  // 5s, 15s, 45s, 135s, 405s (cap 600s).
  const base = 5_000;
  const expanded = base * Math.pow(3, Math.max(0, attempt));
  return Math.min(600_000, expanded);
}

export function createRecoverySchedulingGovernor(
  options?: RecoverySchedulingGovernorOptions,
): RecoverySchedulingGovernor {
  const queue = options?.queue ?? getDefaultExecutionQueue();
  const telemetry = options?.telemetry ?? defaultTelemetrySink;
  const lastScheduledByExec = new Map<string, number>(); // executionId → ts

  return {
    async scheduleStaleRecoveries(input) {
      const nowMs = input.nowMs ?? Date.now();
      const cap = Math.max(1, Math.min(500, input.maxSchedulePerCall ?? 25));
      const concurrentCap = Math.max(1, Math.min(10_000, input.maxConcurrentInFlight ?? 50));
      const suppressionMs = Math.max(0, input.suppressionWindowMs ?? 60_000);

      // 1. Deterministic ordering: stale_age DESC, executionId ASC.
      const sorted = [...input.findings].sort((a, b) => {
        if (b.staleAgeMs !== a.staleAgeMs) return b.staleAgeMs - a.staleAgeMs;
        return a.executionId < b.executionId ? -1 : 1;
      });

      // 2. Check queue depth for backpressure.
      const currentDepth = await queue.depth({ companyId: input.companyId, kind: 'execution_recovery' });
      const concurrencyHeadroom = Math.max(0, concurrentCap - currentDepth);
      if (concurrencyHeadroom === 0 && sorted.length > 0) {
        telemetry.emit('recovery_scheduling_pressure', {
          reason: 'concurrent_cap_reached',
          currentDepth, concurrentCap, requested: sorted.length,
        });
      }

      const decisions: RecoverySchedulingDecision[] = [];
      const scheduledExecutionIds: string[] = [];
      const throttledExecutionIds: string[] = [];
      const suppressedExecutionIds: string[] = [];

      let scheduledThisCall = 0;
      for (const f of sorted) {
        // Suppression window check.
        const lastTs = lastScheduledByExec.get(f.executionId);
        if (lastTs !== undefined && nowMs - lastTs < suppressionMs) {
          decisions.push({
            executionId: f.executionId,
            shouldSchedule: false,
            reason: 'within_suppression_window',
            backoffMs: 0,
            attempt: f.execution.retryCount,
          });
          suppressedExecutionIds.push(f.executionId);
          telemetry.emit('recovery_suppressed', {
            executionId: f.executionId,
            reason: 'within_suppression_window',
            ageSinceLastMs: nowMs - lastTs,
          });
          continue;
        }

        // Per-call cap.
        if (scheduledThisCall >= cap) {
          decisions.push({
            executionId: f.executionId,
            shouldSchedule: false,
            reason: 'per_call_cap_reached',
            backoffMs: 0,
            attempt: f.execution.retryCount,
          });
          throttledExecutionIds.push(f.executionId);
          telemetry.emit('recovery_throttled', {
            executionId: f.executionId,
            reason: 'per_call_cap_reached',
            cap,
          });
          continue;
        }

        // Concurrent-in-flight cap (queue depth based).
        if (scheduledThisCall + currentDepth >= concurrentCap) {
          decisions.push({
            executionId: f.executionId,
            shouldSchedule: false,
            reason: 'concurrent_cap_reached',
            backoffMs: 0,
            attempt: f.execution.retryCount,
          });
          throttledExecutionIds.push(f.executionId);
          telemetry.emit('recovery_throttled', {
            executionId: f.executionId,
            reason: 'concurrent_cap_reached',
            concurrentCap, currentDepth,
          });
          continue;
        }

        // Schedule it.
        const backoffMs = computeBackoffMs(f.execution.retryCount);
        const runAtIso = new Date(nowMs + backoffMs).toISOString();
        try {
          await queue.enqueue({
            executionId: f.executionId,
            companyId: f.execution.companyId,
            kind: 'execution_recovery',
            priority: Math.min(100, 50 + Math.floor(f.staleAgeMs / 60_000)), // older = higher priority
            runAtIso,
            dedupKey: `recovery:${f.executionId}`,
            payload: { reason: f.reason, staleAgeMs: f.staleAgeMs },
          });
          lastScheduledByExec.set(f.executionId, nowMs);
          scheduledExecutionIds.push(f.executionId);
          scheduledThisCall += 1;
          decisions.push({
            executionId: f.executionId,
            shouldSchedule: true,
            reason: `enqueued: ${f.reason}`,
            backoffMs,
            attempt: f.execution.retryCount,
          });
          telemetry.emit('recovery_scheduled', {
            executionId: f.executionId,
            backoffMs, runAtIso,
            reason: f.reason,
          });
        } catch (err) {
          decisions.push({
            executionId: f.executionId,
            shouldSchedule: false,
            reason: `enqueue_failed: ${(err as Error)?.message ?? 'unknown'}`,
            backoffMs,
            attempt: f.execution.retryCount,
          });
        }
      }

      return {
        scheduledExecutionIds,
        throttledExecutionIds,
        suppressedExecutionIds,
        decisions,
      };
    },

    _resetHistory() {
      lastScheduledByExec.clear();
    },
  };
}

// ────────────────────────────────────────────────────────────────────
// Default singleton
// ────────────────────────────────────────────────────────────────────

let _default: RecoverySchedulingGovernor | null = null;
export function getDefaultRecoverySchedulingGovernor(): RecoverySchedulingGovernor {
  if (!_default) _default = createRecoverySchedulingGovernor();
  return _default;
}
export function setDefaultRecoverySchedulingGovernor(g: RecoverySchedulingGovernor): void {
  _default = g;
}

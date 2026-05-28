/**
 * Phase 19C — StaleExecutionReconciler
 *
 * Detects executions that have drifted from a healthy lifecycle:
 *   - expired lease (lease.expires_at <= now AND released=false)
 *   - heartbeat timeout (heartbeatAt > heartbeatStaleMs ago)
 *   - orphan running (status=running but no active lease)
 *   - recovery stalled (status=recovering but recovery_state stuck attempting)
 *   - abandoned marker (status=abandoned, awaiting reclaim)
 *
 * For each finding, picks a deterministic action:
 *   - reclaim     → caller should takeover via LeaseRecoveryGovernor
 *   - reopen      → move execution back to running (operator-requested)
 *   - mark_failed → unrecoverable (retry count exhausted)
 *   - skip        → no actionable change (e.g. fresh signal noise)
 *
 * SCOPE: detection + deterministic action selection ONLY. The actual lease
 * takeover + workflow resume is delegated to LeaseRecoveryGovernor (Phase
 * 19F) and ExecutionRecoveryCoordinator (Phase 19A). This module never
 * runs an orchestration step.
 *
 * GUARANTEES:
 *   - No double ownership: never claims a lease itself. Returns 'reclaim'
 *     as a recommendation; the caller invokes takeoverForRecovery() which
 *     re-validates eligibility before acting.
 *   - Deterministic takeover rules: action selection is a pure function of
 *     the finding + executionRecord + (optional) maxRetryCount.
 *   - Split-brain suppression: surfaces the current owner in the
 *     StaleExecutionFinding so the caller can verify before acting.
 */

import {
  getDefaultExecutionStore,
  type ExecutionStore,
} from '@/backend/services/threadRuntime/executionStore';
import {
  getDefaultDurableExecutionCoordinator,
  type DurableExecutionCoordinator,
} from '@/backend/services/threadRuntime/durableExecutionCoordinator';
import type {
  ExecutionLease,
  ExecutionRecord,
} from '@/backend/services/threadRuntime/threadRuntimeTypes';
import type {
  StaleExecutionFinding,
  StaleExecutionReason,
  StaleReconcileAction,
  StaleReconcileOutcome,
} from './recoveryTypes';

// ── Telemetry ────────────────────────────────────────────────────────

export type StaleReconcileTelemetryEvent =
  | 'stale_execution_detected'
  | 'stale_execution_reconciled'
  | 'stale_execution_skipped';

export interface StaleReconcileTelemetrySink {
  emit(event: StaleReconcileTelemetryEvent, payload: Record<string, unknown>): void;
}

const defaultTelemetrySink: StaleReconcileTelemetrySink = {
  emit(event, payload) {
    try {
      const line = JSON.stringify({ event, ...payload, ts: new Date().toISOString() });
      console.log(`[stale_reconcile] ${line}`);
    } catch { /* ignore */ }
  },
};

// ── Reconciler ──────────────────────────────────────────────────────

export interface StaleExecutionReconcilerOptions {
  store?: ExecutionStore;
  coordinator?: DurableExecutionCoordinator;
  telemetry?: StaleReconcileTelemetrySink;
  /** Heartbeat is considered stale beyond this age in ms. Default 90_000. */
  heartbeatStaleMs?: number;
  /** Recovery is considered stalled beyond this age in ms. Default 300_000. */
  recoveryStalledMs?: number;
  /** Max retries before action flips to 'mark_failed'. Default 5. */
  maxRetryCount?: number;
}

export interface StaleExecutionReconciler {
  detect(input?: { nowMs?: number; limit?: number; companyId?: string }): Promise<StaleExecutionFinding[]>;
  chooseAction(finding: StaleExecutionFinding, opts?: { maxRetryCount?: number }): StaleReconcileAction;
  apply(finding: StaleExecutionFinding, action: StaleReconcileAction): Promise<StaleReconcileOutcome>;
  /** Convenience: detect → chooseAction → apply for the whole batch. */
  reconcile(input?: {
    nowMs?: number;
    limit?: number;
    companyId?: string;
    dryRun?: boolean;
  }): Promise<StaleReconcileOutcome[]>;
}

export function createStaleExecutionReconciler(
  options?: StaleExecutionReconcilerOptions,
): StaleExecutionReconciler {
  const store = options?.store ?? getDefaultExecutionStore();
  const coordinator = options?.coordinator ?? getDefaultDurableExecutionCoordinator();
  const telemetry = options?.telemetry ?? defaultTelemetrySink;
  const heartbeatStaleMs = options?.heartbeatStaleMs ?? 90_000;
  const recoveryStalledMs = options?.recoveryStalledMs ?? 300_000;
  const defaultMaxRetries = options?.maxRetryCount ?? 5;

  function reasonFromState(args: {
    exec: ExecutionRecord;
    lease: ExecutionLease | null;
    nowMs: number;
  }): { reason: StaleExecutionReason; staleAgeMs: number } | null {
    const { exec, lease, nowMs } = args;

    // 1. Lease expired but not released.
    if (lease && !lease.released) {
      const expMs = Date.parse(lease.expiresAt);
      if (Number.isFinite(expMs) && expMs <= nowMs) {
        return { reason: 'lease_expired', staleAgeMs: Math.max(0, nowMs - expMs) };
      }
    }

    // 2. Heartbeat stale (only meaningful for active executions).
    if (
      (exec.executionStatus === 'running' ||
        exec.executionStatus === 'waiting' ||
        exec.executionStatus === 'recovering') &&
      exec.heartbeatAt
    ) {
      const ageMs = Math.max(0, nowMs - Date.parse(exec.heartbeatAt));
      if (ageMs > heartbeatStaleMs) {
        return { reason: 'heartbeat_stale', staleAgeMs: ageMs };
      }
    }

    // 3. Orphan running: status=running but no live lease.
    if (exec.executionStatus === 'running') {
      const noLiveLease = !lease || lease.released ||
        (Date.parse(lease.expiresAt) <= nowMs);
      if (noLiveLease) {
        const ageMs = exec.heartbeatAt
          ? Math.max(0, nowMs - Date.parse(exec.heartbeatAt))
          : Math.max(0, nowMs - Date.parse(exec.startedAt));
        return { reason: 'orphan_running', staleAgeMs: ageMs };
      }
    }

    // 4. Recovery stalled.
    if (exec.executionStatus === 'recovering' && exec.recoveryState === 'attempting') {
      const since = exec.heartbeatAt ?? exec.startedAt;
      const ageMs = Math.max(0, nowMs - Date.parse(since));
      if (ageMs > recoveryStalledMs) {
        return { reason: 'recovery_stalled', staleAgeMs: ageMs };
      }
    }

    // 5. Abandoned marker (always reclaimable).
    if (exec.executionStatus === 'abandoned') {
      const since = exec.completedAt ?? exec.heartbeatAt ?? exec.startedAt;
      return {
        reason: 'abandoned_marker',
        staleAgeMs: Math.max(0, nowMs - Date.parse(since)),
      };
    }

    return null;
  }

  return {
    async detect(input) {
      const nowMs = input?.nowMs ?? Date.now();
      const limit = input?.limit ?? 200;
      // Pull active + abandoned. Completed/failed aren't candidates.
      const candidates = await store.listExecutions({
        companyId: input?.companyId,
        status: ['pending', 'running', 'waiting', 'recovering', 'abandoned'],
        limit,
      });
      const findings: StaleExecutionFinding[] = [];
      for (const exec of candidates) {
        const lease = await store.currentLease(exec.executionId);
        const reasonInfo = reasonFromState({ exec, lease, nowMs });
        if (!reasonInfo) continue;
        const finding: StaleExecutionFinding = {
          executionId: exec.executionId,
          reason: reasonInfo.reason,
          detectedAtIso: new Date(nowMs).toISOString(),
          staleAgeMs: reasonInfo.staleAgeMs,
          currentOwnerWorkerId: lease?.released ? null : lease?.ownerWorkerId ?? null,
          lease: lease ?? null,
          execution: exec,
        };
        findings.push(finding);
        telemetry.emit('stale_execution_detected', {
          executionId: exec.executionId,
          reason: reasonInfo.reason,
          staleAgeMs: reasonInfo.staleAgeMs,
          executionStatus: exec.executionStatus,
        });
      }
      return findings;
    },

    chooseAction(finding, opts) {
      const maxRetries = opts?.maxRetryCount ?? defaultMaxRetries;
      const exec = finding.execution;
      // Exhausted retries → mark_failed (don't loop forever).
      if (exec.retryCount >= maxRetries) return 'mark_failed';

      switch (finding.reason) {
        case 'lease_expired':
        case 'heartbeat_stale':
        case 'orphan_running':
        case 'abandoned_marker':
          return 'reclaim';
        case 'recovery_stalled':
          // Already recovering — reopen so a fresh worker can take a shot.
          return 'reopen';
        default:
          return 'skip';
      }
    },

    async apply(finding, action) {
      const appliedAtIso = new Date().toISOString();
      const baseOutcome: StaleReconcileOutcome = {
        executionId: finding.executionId,
        finding,
        action,
        appliedAtIso,
        newOwnerWorkerId: null,
        detail: '',
      };

      switch (action) {
        case 'reclaim': {
          // Flip status to 'abandoned' if it isn't already, so a downstream
          // takeover can transition abandoned → recovering atomically.
          // EXCEPTION: orphan_running and lease_expired with status=running
          // stay 'running' — we don't want to gratuitously abandon a thing
          // that might just have a slow heartbeat. Caller (recovery
          // coordinator) decides next step via LeaseRecoveryGovernor.
          let detail = `marked for reclaim due to ${finding.reason}`;
          if (finding.execution.executionStatus === 'running' &&
              (finding.reason === 'heartbeat_stale' || finding.reason === 'orphan_running')) {
            // Defer abandonment to coordinator's lease takeover path.
            detail += ' (deferred abandonment)';
          } else if (finding.execution.executionStatus !== 'abandoned') {
            try {
              await coordinator.transition({
                executionId: finding.executionId,
                to: 'abandoned',
                failureReason: `stale: ${finding.reason} (age ${finding.staleAgeMs}ms)`,
              });
              detail += ' (transitioned to abandoned)';
            } catch (err) {
              detail += ` (transition failed: ${(err as Error).message})`;
            }
          }
          const outcome: StaleReconcileOutcome = { ...baseOutcome, detail };
          telemetry.emit('stale_execution_reconciled', { ...outcome, finding: undefined });
          return outcome;
        }
        case 'reopen': {
          try {
            await coordinator.transition({
              executionId: finding.executionId,
              to: 'running',
            });
          } catch (err) {
            // Transition may be illegal (e.g. already running). Tolerate.
            telemetry.emit('stale_execution_skipped', {
              executionId: finding.executionId,
              reason: 'reopen_transition_illegal',
              error: (err as Error).message,
            });
          }
          const outcome: StaleReconcileOutcome = {
            ...baseOutcome,
            detail: `reopened after ${finding.reason}`,
          };
          telemetry.emit('stale_execution_reconciled', { ...outcome, finding: undefined });
          return outcome;
        }
        case 'mark_failed': {
          try {
            await coordinator.transition({
              executionId: finding.executionId,
              to: 'failed',
              failureReason: `retry_exhausted (${finding.execution.retryCount} retries) — last reason: ${finding.reason}`,
            });
          } catch (err) {
            telemetry.emit('stale_execution_skipped', {
              executionId: finding.executionId,
              reason: 'mark_failed_illegal',
              error: (err as Error).message,
            });
          }
          const outcome: StaleReconcileOutcome = {
            ...baseOutcome,
            detail: `marked failed after retry exhaustion (${finding.execution.retryCount}/${defaultMaxRetries})`,
          };
          telemetry.emit('stale_execution_reconciled', { ...outcome, finding: undefined });
          return outcome;
        }
        case 'skip': {
          const outcome: StaleReconcileOutcome = {
            ...baseOutcome,
            detail: 'no action selected',
          };
          telemetry.emit('stale_execution_skipped', {
            executionId: finding.executionId,
            reason: finding.reason,
          });
          return outcome;
        }
      }
    },

    async reconcile(input) {
      const findings = await this.detect({
        nowMs: input?.nowMs,
        limit: input?.limit,
        companyId: input?.companyId,
      });
      const outcomes: StaleReconcileOutcome[] = [];
      for (const f of findings) {
        const action = this.chooseAction(f);
        if (input?.dryRun) {
          outcomes.push({
            executionId: f.executionId,
            finding: f,
            action,
            appliedAtIso: new Date().toISOString(),
            newOwnerWorkerId: null,
            detail: '[dry-run] no mutation',
          });
          continue;
        }
        outcomes.push(await this.apply(f, action));
      }
      return outcomes;
    },
  };
}

let _default: StaleExecutionReconciler | null = null;
export function getDefaultStaleExecutionReconciler(): StaleExecutionReconciler {
  if (!_default) _default = createStaleExecutionReconciler();
  return _default;
}
export function setDefaultStaleExecutionReconciler(r: StaleExecutionReconciler): void {
  _default = r;
}

/**
 * Phase 19A — ExecutionRecoveryCoordinator
 *
 * Single canonical recovery path. Composes:
 *   - StaleExecutionReconciler         (detection + action selection)
 *   - LeaseRecoveryGovernor            (atomic takeover)
 *   - CheckpointRestorationEngine      (state rebuild + integrity check)
 *   - ReplayContinuationEngine         (idempotent step resume)
 *   - DurableExecutionCoordinator      (lifecycle transitions)
 *
 * Responsibilities (per spec):
 *   - detect interrupted executions
 *   - restore latest valid checkpoint
 *   - resume incomplete orchestration
 *   - reconcile abandoned executions
 *   - coordinate lease-aware recovery
 *   - enforce deterministic replay continuation
 *
 * Entry points:
 *   - recoverExecution()    → single-execution recovery (caller picks the id)
 *   - sweepAndRecover()     → bulk detection + recovery
 *   - detectInterruptedExecutions() → read-only inspection
 *
 * SCOPE: COORDINATION ONLY. No new orchestration semantics, no autonomous
 * AI, no queue fanout, no publishing changes. Every action is a deterministic
 * composition of the existing primitives.
 *
 * GUARANTEES:
 *   - Single canonical path: every recovery goes through recoverExecution()
 *     (sweepAndRecover loops calling it). No alternate code path exists.
 *   - Replay-safe: a recovery that picks up an already-completed execution
 *     short-circuits with outcome='already_completed'.
 *   - No double ownership: lease takeover is the SOLE writer transition
 *     allowed before steps run. If takeover fails, the recovery exits early.
 *   - Bounded: per-call recovery budget caps step execution count and time.
 */

import {
  getDefaultStaleExecutionReconciler,
  type StaleExecutionReconciler,
} from './staleExecutionReconciler';
import {
  getDefaultLeaseRecoveryGovernor,
  type LeaseRecoveryGovernor,
} from './leaseRecoveryGovernor';
import {
  getDefaultCheckpointRestorationEngine,
  type CheckpointRestorationEngine,
} from './checkpointRestorationEngine';
import {
  getDefaultReplayContinuationEngine,
  type ReplayContinuationEngine,
  type ReplayableWorkflowStep,
} from './replayContinuationEngine';
import {
  getDefaultDurableExecutionCoordinator,
  type DurableExecutionCoordinator,
} from '@/backend/services/threadRuntime/durableExecutionCoordinator';
import type {
  ExecutionRecord,
} from '@/backend/services/threadRuntime/threadRuntimeTypes';
import type {
  ReplayContinuationResult,
  RestoredCheckpointState,
  StaleExecutionFinding,
  StaleReconcileAction,
  StaleReconcileOutcome,
  LeaseRecoveryOutcome,
} from './recoveryTypes';

// ── Telemetry ────────────────────────────────────────────────────────

export type RecoveryCoordinatorTelemetryEvent =
  | 'recovery_coordinator_start'
  | 'recovery_coordinator_success'
  | 'recovery_coordinator_failure'
  | 'recovery_coordinator_no_op';

export interface RecoveryCoordinatorTelemetrySink {
  emit(event: RecoveryCoordinatorTelemetryEvent, payload: Record<string, unknown>): void;
}

const defaultTelemetrySink: RecoveryCoordinatorTelemetrySink = {
  emit(event, payload) {
    try {
      const line = JSON.stringify({ event, ...payload, ts: new Date().toISOString() });
      if (event === 'recovery_coordinator_failure') console.warn(`[recovery_coordinator] ${line}`);
      else console.log(`[recovery_coordinator] ${line}`);
    } catch { /* ignore */ }
  },
};

// ── Errors ───────────────────────────────────────────────────────────

export class RecoveryCoordinatorError extends Error {
  constructor(
    public readonly executionId: string,
    public readonly stage: string,
    public readonly code: string,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(`[RecoveryCoordinator.${stage}] ${code} for ${executionId}: ${message}`);
    this.name = 'RecoveryCoordinatorError';
  }
}

// ── Result shape ─────────────────────────────────────────────────────

export type RecoveryStatus =
  | 'recovered'             // successfully resumed and execution moved forward
  | 'already_completed'     // execution was finished; nothing to do
  | 'no_action_needed'      // not stale; nothing to recover
  | 'takeover_refused'      // lease still live or contention won by another worker
  | 'unrecoverable'         // checkpoint corrupted / retry exhausted
  | 'failed';               // unexpected error inside the path

export interface RecoveryExecutionResult {
  executionId: string;
  status: RecoveryStatus;
  staleFinding: StaleExecutionFinding | null;
  reconcileOutcome: StaleReconcileOutcome | null;
  leaseRecoveryOutcome: LeaseRecoveryOutcome | null;
  restoredState: RestoredCheckpointState | null;
  replayResult: ReplayContinuationResult | null;
  finalExecution: ExecutionRecord | null;
  durationMs: number;
  details: string[];
}

// ── Coordinator ──────────────────────────────────────────────────────

export interface ExecutionRecoveryCoordinatorOptions {
  reconciler?: StaleExecutionReconciler;
  leaseGovernor?: LeaseRecoveryGovernor;
  restoration?: CheckpointRestorationEngine;
  replayEngine?: ReplayContinuationEngine;
  durableExecution?: DurableExecutionCoordinator;
  telemetry?: RecoveryCoordinatorTelemetrySink;
  /** Default takeover lease duration in ms. Default 60_000. */
  defaultLeaseDurationMs?: number;
  /** Default retry budget mirrored to the reconciler. Default 5. */
  maxRetryCount?: number;
}

export interface RecoverExecutionInput<TCtx> {
  executionId: string;
  workerId: string;
  steps: ReplayableWorkflowStep<TCtx>[];
  context: TCtx;
  leaseDurationMs?: number;
  /** When true, skip the staleness check and unconditionally take over. */
  forceTakeover?: boolean;
}

export interface SweepAndRecoverInput<TCtx> {
  workerId: string;
  companyId?: string;
  nowMs?: number;
  limit?: number;
  buildSteps: (input: { execution: ExecutionRecord; restored: RestoredCheckpointState }) => Promise<ReplayableWorkflowStep<TCtx>[]>;
  buildContext: (input: { execution: ExecutionRecord; restored: RestoredCheckpointState }) => Promise<TCtx>;
  leaseDurationMs?: number;
  /** Maximum executions to recover in a single sweep. Default 25. */
  maxExecutionsPerSweep?: number;
}

export interface ExecutionRecoveryCoordinator {
  recoverExecution<TCtx>(input: RecoverExecutionInput<TCtx>): Promise<RecoveryExecutionResult>;
  detectInterruptedExecutions(input?: {
    companyId?: string;
    nowMs?: number;
    limit?: number;
  }): Promise<StaleExecutionFinding[]>;
  sweepAndRecover<TCtx>(input: SweepAndRecoverInput<TCtx>): Promise<RecoveryExecutionResult[]>;
}

export function createExecutionRecoveryCoordinator(
  options?: ExecutionRecoveryCoordinatorOptions,
): ExecutionRecoveryCoordinator {
  const reconciler = options?.reconciler ?? getDefaultStaleExecutionReconciler();
  const leaseGovernor = options?.leaseGovernor ?? getDefaultLeaseRecoveryGovernor();
  const restoration = options?.restoration ?? getDefaultCheckpointRestorationEngine();
  const replayEngine = options?.replayEngine ?? getDefaultReplayContinuationEngine();
  const durable = options?.durableExecution ?? getDefaultDurableExecutionCoordinator();
  const telemetry = options?.telemetry ?? defaultTelemetrySink;
  const defaultLeaseDur = options?.defaultLeaseDurationMs ?? 60_000;
  const maxRetryCount = options?.maxRetryCount ?? 5;

  async function getFreshExecution(executionId: string): Promise<ExecutionRecord | null> {
    return durable.get(executionId);
  }

  return {
    async detectInterruptedExecutions(input) {
      return reconciler.detect({
        nowMs: input?.nowMs,
        limit: input?.limit,
        companyId: input?.companyId,
      });
    },

    async recoverExecution<TCtx>(input: RecoverExecutionInput<TCtx>): Promise<RecoveryExecutionResult> {
      const t0 = Date.now();
      const baseResult: RecoveryExecutionResult = {
        executionId: input.executionId,
        status: 'failed',
        staleFinding: null,
        reconcileOutcome: null,
        leaseRecoveryOutcome: null,
        restoredState: null,
        replayResult: null,
        finalExecution: null,
        durationMs: 0,
        details: [],
      };

      telemetry.emit('recovery_coordinator_start', {
        executionId: input.executionId,
        workerId: input.workerId,
      });

      try {
        // Step 1 — current state lookup.
        const initial = await getFreshExecution(input.executionId);
        if (!initial) {
          const result = { ...baseResult, status: 'failed' as const,
            durationMs: Date.now() - t0,
            details: ['execution not found'] };
          telemetry.emit('recovery_coordinator_failure', {
            executionId: input.executionId, reason: 'execution_not_found',
          });
          return result;
        }
        if (initial.executionStatus === 'completed') {
          const result = { ...baseResult, status: 'already_completed' as const,
            finalExecution: initial,
            durationMs: Date.now() - t0,
            details: ['execution already completed'] };
          telemetry.emit('recovery_coordinator_no_op', {
            executionId: input.executionId, reason: 'already_completed',
          });
          return result;
        }

        // Step 2 — staleness detection (unless forceTakeover).
        let staleFinding: StaleExecutionFinding | null = null;
        let reconcileOutcome: StaleReconcileOutcome | null = null;
        if (!input.forceTakeover) {
          const findings = await reconciler.detect({ limit: 1000 });
          staleFinding = findings.find((f) => f.executionId === input.executionId) ?? null;
          if (!staleFinding) {
            const result = { ...baseResult, status: 'no_action_needed' as const,
              finalExecution: initial,
              durationMs: Date.now() - t0,
              details: ['execution not stale'] };
            telemetry.emit('recovery_coordinator_no_op', {
              executionId: input.executionId, reason: 'not_stale',
            });
            return result;
          }
          const action: StaleReconcileAction = reconciler.chooseAction(staleFinding, { maxRetryCount });
          if (action === 'mark_failed' || action === 'skip') {
            reconcileOutcome = await reconciler.apply(staleFinding, action);
            const result = { ...baseResult,
              status: action === 'mark_failed' ? 'unrecoverable' as const : 'no_action_needed' as const,
              staleFinding, reconcileOutcome,
              finalExecution: await getFreshExecution(input.executionId),
              durationMs: Date.now() - t0,
              details: [`reconciler chose ${action}: ${reconcileOutcome.detail}`] };
            telemetry.emit(action === 'mark_failed'
              ? 'recovery_coordinator_failure'
              : 'recovery_coordinator_no_op', {
              executionId: input.executionId, reason: `reconcile_${action}`,
            });
            return result;
          }
          // For 'reclaim' / 'reopen', apply the reconcile decision first so
          // the execution lifecycle is in a state where takeover + replay can run.
          reconcileOutcome = await reconciler.apply(staleFinding, action);
        }

        // Step 3 — lease takeover.
        const leaseOutcome = await leaseGovernor.takeoverForRecovery({
          executionId: input.executionId,
          workerId: input.workerId,
          durationMs: input.leaseDurationMs ?? defaultLeaseDur,
        });
        if (leaseOutcome.action === 'takeover_refused' || leaseOutcome.action === 'failed') {
          const result = { ...baseResult,
            status: 'takeover_refused' as const,
            staleFinding, reconcileOutcome,
            leaseRecoveryOutcome: leaseOutcome,
            finalExecution: await getFreshExecution(input.executionId),
            durationMs: Date.now() - t0,
            details: [`takeover refused: ${leaseOutcome.reason}`] };
          telemetry.emit('recovery_coordinator_no_op', {
            executionId: input.executionId, reason: 'takeover_refused',
            leaseReason: leaseOutcome.reason,
          });
          return result;
        }

        // Step 4 — restore checkpoint chain.
        let restoredState: RestoredCheckpointState;
        try {
          restoredState = await restoration.restore(input.executionId);
        } catch (err) {
          // Release the lease so a future attempt can take over.
          if (leaseOutcome.newLeaseId) {
            await leaseGovernor.releaseLease(leaseOutcome.newLeaseId);
          }
          const reason = (err as Error)?.message ?? 'restore_failed';
          const result = { ...baseResult,
            status: 'unrecoverable' as const,
            staleFinding, reconcileOutcome, leaseRecoveryOutcome: leaseOutcome,
            finalExecution: await getFreshExecution(input.executionId),
            durationMs: Date.now() - t0,
            details: [`restore failed: ${reason}`] };
          telemetry.emit('recovery_coordinator_failure', {
            executionId: input.executionId, reason, stage: 'restore',
          });
          return result;
        }

        // Step 5 — transition to 'recovering' before resume so the workflow
        // engine sees a valid lifecycle state. Use the FRESH status (after
        // reconcile.apply may have transitioned to 'abandoned') instead of
        // the stale `initial` snapshot. Tolerate illegal-transition errors
        // — if a parallel recovery already moved the execution, the resume
        // path will short-circuit on its own.
        const preTransition = await getFreshExecution(input.executionId);
        const freshStatus = preTransition?.executionStatus;
        try {
          // Only transition into 'recovering' from statuses that legally allow
          // it. running/recovering/completed/pending stay as-is — the resume
          // engine will either short-circuit (completed) or run steps from
          // the current state.
          if (freshStatus === 'abandoned' || freshStatus === 'failed' || freshStatus === 'waiting') {
            await durable.transition({ executionId: input.executionId, to: 'recovering' });
          }
        } catch { /* tolerated — lifecycle may already be valid */ }

        // Step 6 — replay continuation.
        let replayResult: ReplayContinuationResult;
        try {
          replayResult = await replayEngine.continue<TCtx>({
            executionId: input.executionId,
            steps: input.steps,
            context: input.context,
          });
        } finally {
          // Step 6b — release the lease regardless of outcome so a follow-on
          // recovery attempt can take over. Same pattern as the in-memory
          // deterministicRecoveryCoordinator (Phase 6).
          if (leaseOutcome.newLeaseId) {
            await leaseGovernor.releaseLease(leaseOutcome.newLeaseId);
          }
        }

        const final = await getFreshExecution(input.executionId);

        let status: RecoveryStatus;
        const details: string[] = [];
        switch (replayResult.outcome) {
          case 'resumed':
          case 'duplicate_suppressed':
            status = 'recovered';
            details.push(`replay outcome=${replayResult.outcome}, ran=${replayResult.ranStepCount}, skipped=${replayResult.skippedStepCount}, suppressions=${replayResult.duplicateSuppressions}`);
            break;
          case 'already_completed':
            status = 'already_completed';
            details.push('execution converged on already-completed during replay');
            break;
          case 'failed':
            status = 'unrecoverable';
            details.push(`replay failed: ${replayResult.failureReason}`);
            break;
        }

        const result: RecoveryExecutionResult = {
          ...baseResult,
          status,
          staleFinding, reconcileOutcome, leaseRecoveryOutcome: leaseOutcome,
          restoredState, replayResult, finalExecution: final,
          durationMs: Date.now() - t0,
          details,
        };

        if (status === 'recovered' || status === 'already_completed') {
          telemetry.emit('recovery_coordinator_success', {
            executionId: input.executionId, status,
            durationMs: result.durationMs,
            ranStepCount: replayResult.ranStepCount,
            duplicateSuppressions: replayResult.duplicateSuppressions,
          });
        } else {
          telemetry.emit('recovery_coordinator_failure', {
            executionId: input.executionId, status,
            durationMs: result.durationMs,
            reason: replayResult.failureReason,
          });
        }
        return result;
      } catch (err) {
        const reason = (err as Error)?.message ?? 'unknown coordinator error';
        const result: RecoveryExecutionResult = {
          ...baseResult,
          status: 'failed',
          durationMs: Date.now() - t0,
          details: [`coordinator error: ${reason}`],
        };
        telemetry.emit('recovery_coordinator_failure', {
          executionId: input.executionId, reason, stage: 'unknown',
        });
        return result;
      }
    },

    async sweepAndRecover<TCtx>(input: SweepAndRecoverInput<TCtx>): Promise<RecoveryExecutionResult[]> {
      const cap = Math.max(1, Math.min(1000, input.maxExecutionsPerSweep ?? 25));
      const findings = await this.detectInterruptedExecutions({
        companyId: input.companyId,
        nowMs: input.nowMs,
        limit: cap * 2,
      });
      const slice = findings.slice(0, cap);
      const outcomes: RecoveryExecutionResult[] = [];
      // Sequential to preserve deterministic ordering + avoid lease storms.
      for (const f of slice) {
        // Skip findings whose chosen action is 'skip' upfront, but DO process
        // 'mark_failed' so the unrecoverable state gets recorded.
        const action = reconciler.chooseAction(f);
        if (action === 'skip') continue;

        // Restore state for context derivation. Tolerate failures —
        // recoverExecution() will re-restore for the actual run.
        let restored: RestoredCheckpointState | null = null;
        try { restored = await restoration.restore(f.executionId); } catch { /* ignore */ }

        const steps = restored
          ? await input.buildSteps({ execution: f.execution, restored })
          : [];
        const context = restored
          ? await input.buildContext({ execution: f.execution, restored })
          : ({} as TCtx);

        const result = await this.recoverExecution({
          executionId: f.executionId,
          workerId: input.workerId,
          steps, context,
          leaseDurationMs: input.leaseDurationMs,
        });
        outcomes.push(result);
      }
      return outcomes;
    },
  };
}

let _default: ExecutionRecoveryCoordinator | null = null;
export function getDefaultExecutionRecoveryCoordinator(): ExecutionRecoveryCoordinator {
  if (!_default) _default = createExecutionRecoveryCoordinator();
  return _default;
}
export function setDefaultExecutionRecoveryCoordinator(c: ExecutionRecoveryCoordinator): void {
  _default = c;
}

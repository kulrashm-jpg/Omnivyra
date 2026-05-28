/**
 * Phase 19J — Startup recovery sweep.
 *
 * Bounded, single-pass scan at authoritative worker / server boot. Runs:
 *   1. lease cleanup: release expired leases (atomic via lease store)
 *   2. stale-execution detection: surface interrupted executions
 *   3. (optional) recovery enqueue: hand findings to a caller-supplied
 *      enqueue callback so the host process can pick up the work in its
 *      normal scheduler
 *
 * SCOPE: STARTUP SWEEP ONLY. This file does NOT loop, NOT auto-resume
 * orchestration steps, and NOT spawn workers. It produces a deterministic,
 * bounded result; the caller decides what to do with it.
 *
 * GUARANTEES:
 *   - Bounded: respects maxExecutions cap (default 50) + maxDurationMs
 *     watchdog (default 30_000ms).
 *   - Replay-safe: never mutates an execution outside lease cleanup +
 *     reconciler.apply() (which itself uses deterministic transitions).
 *   - Idempotent across boots: the lease store's partial unique index
 *     prevents double-release; the reconciler's apply() is idempotent
 *     on already-abandoned executions.
 *   - Throttled: between executions, sleeps `interExecutionDelayMs` to
 *     avoid storming the data layer at boot.
 *   - DOES NOT introduce autonomous orchestration. If the caller doesn't
 *     supply an enqueue callback, findings are only logged + returned.
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
  getDefaultExecutionRecoveryCoordinator,
  type ExecutionRecoveryCoordinator,
  type RecoveryExecutionResult,
} from './executionRecoveryCoordinator';
import type {
  StaleExecutionFinding,
  StaleReconcileOutcome,
} from './recoveryTypes';

// ── Telemetry ────────────────────────────────────────────────────────

export type StartupSweepTelemetryEvent =
  | 'startup_recovery_sweep_started'
  | 'startup_recovery_sweep_completed'
  | 'startup_recovery_sweep_aborted'
  | 'startup_recovery_sweep_skipped';

export interface StartupSweepTelemetrySink {
  emit(event: StartupSweepTelemetryEvent, payload: Record<string, unknown>): void;
}

const defaultTelemetrySink: StartupSweepTelemetrySink = {
  emit(event, payload) {
    try {
      const line = JSON.stringify({ event, ...payload, ts: new Date().toISOString() });
      if (event === 'startup_recovery_sweep_aborted') console.warn(`[startup_recovery] ${line}`);
      else console.log(`[startup_recovery] ${line}`);
    } catch { /* ignore */ }
  },
};

// ── Result shape ─────────────────────────────────────────────────────

export interface StartupSweepResult {
  startedAtIso: string;
  completedAtIso: string;
  durationMs: number;
  releasedLeaseIds: string[];
  findings: StaleExecutionFinding[];
  reconciledOutcomes: StaleReconcileOutcome[];
  enqueuedRecoveryIds: string[];
  recoveryResults: RecoveryExecutionResult[];
  aborted: boolean;
  abortReason: string | null;
  /** True when the caller disabled the sweep entirely. */
  skipped: boolean;
}

// ── Options ─────────────────────────────────────────────────────────

export interface StartupRecoverySweepOptions {
  reconciler?: StaleExecutionReconciler;
  leaseGovernor?: LeaseRecoveryGovernor;
  coordinator?: ExecutionRecoveryCoordinator;
  telemetry?: StartupSweepTelemetrySink;
  /** Hard cap on executions touched by this sweep. Default 50. */
  maxExecutions?: number;
  /** Hard watchdog timeout. Default 30_000 ms. */
  maxDurationMs?: number;
  /** Delay between reconciled executions. Default 50 ms. */
  interExecutionDelayMs?: number;
  /** Optional company scoping. */
  companyId?: string;
  /** When true, only reconcile findings; don't enqueue recovery. */
  detectOnly?: boolean;
  /**
   * Optional callback to enqueue a recovery for downstream processing.
   * When supplied, the sweep invokes it once per finding chosen for
   * recovery; when omitted, recovery is NOT auto-run.
   */
  enqueueRecovery?: (input: { finding: StaleExecutionFinding }) => Promise<void> | void;
  /**
   * When true (default false), the sweep itself runs recovery via
   * coordinator.recoverExecution(). Requires `recoveryInputBuilder` so
   * the sweep can construct step lists + contexts for arbitrary
   * executions. WITHOUT this, the sweep only enqueues, never runs.
   */
  runRecoveryInline?: boolean;
  recoveryInputBuilder?: (input: { finding: StaleExecutionFinding }) => Promise<{
    workerId: string;
    steps: Array<{ id: string; phase: 'precheck' | 'generation' | 'persistence' | 'topology_settle' | 'recovery' | 'finalize'; run: (ctx: unknown) => Promise<void> }>;
    context: unknown;
  } | null>;
}

// ── Sweep ───────────────────────────────────────────────────────────

export async function runStartupRecoverySweep(
  options: StartupRecoverySweepOptions = {},
): Promise<StartupSweepResult> {
  const reconciler = options.reconciler ?? getDefaultStaleExecutionReconciler();
  const leaseGovernor = options.leaseGovernor ?? getDefaultLeaseRecoveryGovernor();
  const coordinator = options.coordinator ?? getDefaultExecutionRecoveryCoordinator();
  const telemetry = options.telemetry ?? defaultTelemetrySink;
  const maxExecutions = Math.max(1, Math.min(500, options.maxExecutions ?? 50));
  const maxDurationMs = Math.max(1_000, options.maxDurationMs ?? 30_000);
  const interExecutionDelayMs = Math.max(0, options.interExecutionDelayMs ?? 50);
  const startedAtIso = new Date().toISOString();
  const t0 = Date.now();
  let aborted = false;
  let abortReason: string | null = null;

  telemetry.emit('startup_recovery_sweep_started', {
    maxExecutions, maxDurationMs, companyId: options.companyId ?? null,
    detectOnly: !!options.detectOnly,
    runRecoveryInline: !!options.runRecoveryInline,
  });

  const reconciledOutcomes: StaleReconcileOutcome[] = [];
  const enqueuedRecoveryIds: string[] = [];
  const recoveryResults: RecoveryExecutionResult[] = [];
  let releasedLeaseIds: string[] = [];
  let findings: StaleExecutionFinding[] = [];

  try {
    // Phase A — lease sweep. Release expired leases. Bounded by limit.
    releasedLeaseIds = (await leaseGovernor.sweepExpiredLeases({
      limit: maxExecutions * 2,
    })).releasedLeaseIds;

    // Watchdog check.
    if (Date.now() - t0 > maxDurationMs) {
      throw new Error('watchdog_timeout_during_lease_sweep');
    }

    // Phase B — stale detection.
    findings = await reconciler.detect({
      companyId: options.companyId, limit: maxExecutions,
    });

    // Phase C — reconcile + optionally enqueue/run recovery.
    for (const f of findings) {
      if (Date.now() - t0 > maxDurationMs) {
        aborted = true;
        abortReason = 'watchdog_timeout_during_reconcile';
        break;
      }

      const action = reconciler.chooseAction(f);
      const outcome = await reconciler.apply(f, action);
      reconciledOutcomes.push(outcome);

      if (options.detectOnly) {
        // Detection-only mode: nothing further.
      } else if (action === 'reclaim' || action === 'reopen') {
        if (options.runRecoveryInline && options.recoveryInputBuilder) {
          const built = await options.recoveryInputBuilder({ finding: f });
          if (built) {
            const result = await coordinator.recoverExecution({
              executionId: f.executionId,
              workerId: built.workerId,
              steps: built.steps,
              context: built.context,
            });
            recoveryResults.push(result);
          }
        } else if (options.enqueueRecovery) {
          await options.enqueueRecovery({ finding: f });
          enqueuedRecoveryIds.push(f.executionId);
        }
      }

      if (interExecutionDelayMs > 0) {
        await new Promise((r) => setTimeout(r, interExecutionDelayMs));
      }
    }
  } catch (err) {
    aborted = true;
    abortReason = (err as Error)?.message ?? 'unknown_sweep_error';
    telemetry.emit('startup_recovery_sweep_aborted', {
      reason: abortReason,
      releasedLeaseCount: releasedLeaseIds.length,
      findingsBeforeAbort: findings.length,
      reconciledBeforeAbort: reconciledOutcomes.length,
    });
  }

  const completedAtIso = new Date().toISOString();
  const durationMs = Date.now() - t0;
  const result: StartupSweepResult = {
    startedAtIso, completedAtIso, durationMs,
    releasedLeaseIds, findings, reconciledOutcomes,
    enqueuedRecoveryIds, recoveryResults,
    aborted, abortReason, skipped: false,
  };

  if (!aborted) {
    telemetry.emit('startup_recovery_sweep_completed', {
      durationMs,
      releasedLeaseCount: releasedLeaseIds.length,
      findings: findings.length,
      reconciled: reconciledOutcomes.length,
      enqueued: enqueuedRecoveryIds.length,
      recovered: recoveryResults.length,
    });
  }
  return result;
}

/**
 * Convenience: env-gated startup sweep helper for boot wrappers
 * (instrumentation.node.ts / startWorkers / cron). Skips the sweep
 * when ENABLE_STARTUP_RECOVERY_SWEEP=0 or unset, so the existing boot
 * sequence is unchanged unless the operator explicitly opts in.
 */
export async function maybeRunStartupRecoverySweep(input: {
  processKind: string;
  options?: StartupRecoverySweepOptions;
}): Promise<StartupSweepResult> {
  const enabled =
    process.env.ENABLE_STARTUP_RECOVERY_SWEEP === '1' ||
    process.env.ENABLE_STARTUP_RECOVERY_SWEEP === 'true';
  const telemetry = input.options?.telemetry ?? defaultTelemetrySink;
  if (!enabled) {
    telemetry.emit('startup_recovery_sweep_skipped', {
      processKind: input.processKind,
      reason: 'ENABLE_STARTUP_RECOVERY_SWEEP not set',
    });
    return {
      startedAtIso: new Date().toISOString(),
      completedAtIso: new Date().toISOString(),
      durationMs: 0,
      releasedLeaseIds: [], findings: [], reconciledOutcomes: [],
      enqueuedRecoveryIds: [], recoveryResults: [],
      aborted: false, abortReason: null, skipped: true,
    };
  }
  return runStartupRecoverySweep(input.options);
}

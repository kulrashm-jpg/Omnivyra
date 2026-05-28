/**
 * Phase 20J — Startup distributed runtime activation.
 *
 * Bounded, env-gated initializer invoked at authoritative worker boot.
 * Sets up:
 *   1. Distributed worker coordinator + worker registration
 *   2. Periodic heartbeat loop
 *   3. Bounded queue poll loop (DistributedExecutionRunner)
 *   4. Periodic stale-worker sweep
 *   5. Periodic recovery scheduling tick (consumes Phase 19 reconciler
 *      findings; bounded by recovery scheduling governor)
 *   6. Throughput governor wired into the runner's pre-claim check
 *
 * SCOPE: BOOT WIRING ONLY. No autonomous orchestration. No worker scaling.
 * No queue fanout. Loops are bounded; the caller controls cadence.
 *
 * ENV GATE: ENABLE_DISTRIBUTED_EXECUTION_RUNTIME=1 (default: disabled).
 * Bootstrap returns a skipped-result when the env var is unset so the
 * existing boot sequence is unchanged.
 */

import {
  getDefaultDistributedWorkerCoordinator,
  type DistributedWorkerCoordinator,
} from './distributedWorkerCoordinator';
import {
  getDefaultDistributedExecutionRunner,
  type DistributedExecutionRunner,
} from './distributedExecutionRunner';
import {
  getDefaultRecoverySchedulingGovernor,
  type RecoverySchedulingGovernor,
} from './recoverySchedulingGovernor';
import {
  getDefaultStaleExecutionReconciler,
  type StaleExecutionReconciler,
} from '@/backend/services/orchestration/recovery/staleExecutionReconciler';
import {
  getDefaultExecutionQueue,
  type DistributedExecutionQueue,
} from './distributedExecutionQueue';
import type {
  WorkerCapability,
  WorkerKind,
} from './distributedTypes';
import type { RunnerStepBuilders } from './distributedExecutionRunner';
import {
  getDefaultDurableQueueReplayCoordinator,
  type DurableQueueReplayCoordinator,
} from './durableQueueReplayCoordinator';
import {
  getDefaultRuntimePersistenceCompactor,
  type RuntimePersistenceCompactor,
} from './runtimePersistenceCompactor';
import {
  getDefaultDistributedRuntimeActivationGovernor,
  type DistributedRuntimeActivationGovernor,
  DistributedRuntimeActivationError,
} from './distributedRuntimeActivationGovernor';
import {
  getDefaultExecutionStore,
} from '@/backend/services/threadRuntime/executionStore';

// ────────────────────────────────────────────────────────────────────
// Telemetry
// ────────────────────────────────────────────────────────────────────

export type StartupRuntimeTelemetryEvent =
  | 'distributed_runtime_skipped'
  | 'distributed_runtime_started'
  | 'distributed_runtime_stopped'
  | 'distributed_runtime_heartbeat'
  | 'distributed_runtime_sweep'
  | 'distributed_runtime_recovery_tick'
  | 'distributed_runtime_replay_tick'
  | 'distributed_runtime_compaction_tick'
  | 'distributed_runtime_shutdown_drained';

export interface StartupRuntimeTelemetrySink {
  emit(event: StartupRuntimeTelemetryEvent, payload: Record<string, unknown>): void;
}

const defaultTelemetrySink: StartupRuntimeTelemetrySink = {
  emit(event, payload) {
    try {
      const line = JSON.stringify({ event, ...payload, ts: new Date().toISOString() });
      if (event === 'distributed_runtime_skipped') console.log(`[distributed_runtime] ${line}`);
      else console.log(`[distributed_runtime] ${line}`);
    } catch { /* ignore */ }
  },
};

// ────────────────────────────────────────────────────────────────────
// Options
// ────────────────────────────────────────────────────────────────────

export interface StartupDistributedRuntimeOptions<TCtx> {
  workerId: string;
  workerKind: WorkerKind;
  capabilities: WorkerCapability[];
  builders: RunnerStepBuilders<TCtx>;
  /** Heartbeat interval ms. Default 15_000. */
  heartbeatIntervalMs?: number;
  /** Stale-worker sweep interval ms. Default 30_000. */
  staleSweepIntervalMs?: number;
  /** Recovery scheduling tick interval ms. Default 30_000. */
  recoveryTickIntervalMs?: number;
  /**
   * Phase 21J — durable queue replay tick interval ms. Default 60_000.
   * Used when ENABLE_DURABLE_DISTRIBUTED_RUNTIME=1 to periodically scan
   * the durable queue for visibility-expired claims + delayed-ready entries.
   */
  replayTickIntervalMs?: number;
  /**
   * Phase 21J — runtime persistence compaction tick interval ms.
   * Default 3_600_000 (1 hour). Bounded; one pass per tick.
   */
  compactionTickIntervalMs?: number;
  /** Runner concurrency. Default 4. */
  runnerConcurrency?: number;
  /** Max runner iterations per loop call. Default 200. */
  maxIterationsPerLoop?: number;
  /** Idle delay between empty polls. Default 250 ms. */
  idleDelayMs?: number;
  /** Visibility timeout for queue claims. Default 60_000 ms. */
  visibilityMs?: number;
  /** Lease duration for ownership takeover. Default 60_000 ms. */
  leaseDurationMs?: number;
  hostname?: string;
  processIdentity?: string;
  // Test injection.
  workerCoordinator?: DistributedWorkerCoordinator;
  runner?: DistributedExecutionRunner;
  reconciler?: StaleExecutionReconciler;
  recoveryGovernor?: RecoverySchedulingGovernor;
  queue?: DistributedExecutionQueue;
  /** Phase 21J — optional injection for tests. */
  replayCoordinator?: DurableQueueReplayCoordinator;
  /** Phase 21J — optional injection for tests. */
  compactor?: RuntimePersistenceCompactor;
  /** Phase 22A — optional activation governor injection. */
  activationGovernor?: DistributedRuntimeActivationGovernor;
  /**
   * Phase 22A — when true (default true when enableDurableReplayLoops is on),
   * run the activation governor BEFORE starting any loops. Hard-fails when
   * any validator refuses. Skipped only when explicitly disabled — there
   * is NO silent downgrade.
   */
  runActivationGovernor?: boolean;
  /**
   * Phase 22F — optional process-level shutdown signals to bind. When true
   * (default false), startDistributedRuntime registers SIGINT + SIGTERM
   * handlers that invoke handle.stop(). Set false in environments that
   * manage their own signal handling (e.g. Next.js instrumentation).
   */
  bindShutdownSignals?: boolean;
  telemetry?: StartupRuntimeTelemetrySink;
  /** Run mode: 'background' (default) starts loops + returns handle.
   *  'oneshot' runs a single runner pass and returns. */
  mode?: 'background' | 'oneshot';
  /**
   * Phase 21J — when true, schedule queue-replay + compaction loops
   * alongside the runner. Default: env-gated via
   * ENABLE_DURABLE_DISTRIBUTED_RUNTIME=1. When false, only the legacy
   * Phase 20J loops run (heartbeat + sweep + recovery tick).
   */
  enableDurableReplayLoops?: boolean;
  /**
   * Phase 21J — when true, queue replay + compaction loops actually run.
   * Set automatically when enableDurableReplayLoops resolves truthy.
   */
}

export interface DistributedRuntimeHandle {
  workerId: string;
  stop(): Promise<void>;
  isRunning(): boolean;
}

export interface StartupDistributedRuntimeResult {
  skipped: boolean;
  startedAtIso: string;
  handle: DistributedRuntimeHandle | null;
  reason: string | null;
}

// ────────────────────────────────────────────────────────────────────
// Activation
// ────────────────────────────────────────────────────────────────────

export async function startDistributedRuntime<TCtx>(
  options: StartupDistributedRuntimeOptions<TCtx>,
): Promise<StartupDistributedRuntimeResult> {
  const telemetry = options.telemetry ?? defaultTelemetrySink;
  const workerCoord = options.workerCoordinator ?? getDefaultDistributedWorkerCoordinator();
  const runner = options.runner ?? getDefaultDistributedExecutionRunner();
  const reconciler = options.reconciler ?? getDefaultStaleExecutionReconciler();
  const recoveryGovernor = options.recoveryGovernor ?? getDefaultRecoverySchedulingGovernor();
  const queue = options.queue ?? getDefaultExecutionQueue();
  const replayCoord = options.replayCoordinator ?? getDefaultDurableQueueReplayCoordinator();
  const compactor = options.compactor ?? getDefaultRuntimePersistenceCompactor();
  const activationGovernor = options.activationGovernor ?? getDefaultDistributedRuntimeActivationGovernor();
  const heartbeatMs = Math.max(1_000, options.heartbeatIntervalMs ?? 15_000);
  const sweepMs = Math.max(2_000, options.staleSweepIntervalMs ?? 30_000);
  const recoveryMs = Math.max(2_000, options.recoveryTickIntervalMs ?? 30_000);
  // Phase 21J — durable loops cadence.
  const replayMs = Math.max(5_000, options.replayTickIntervalMs ?? 60_000);
  const compactionMs = Math.max(60_000, options.compactionTickIntervalMs ?? 3_600_000);
  const enableDurableLoops = typeof options.enableDurableReplayLoops === 'boolean'
    ? options.enableDurableReplayLoops
    : (process.env.ENABLE_DURABLE_DISTRIBUTED_RUNTIME === '1' ||
       process.env.ENABLE_DURABLE_DISTRIBUTED_RUNTIME === 'true');
  const startedAtIso = new Date().toISOString();
  const mode = options.mode ?? 'background';

  // Phase 22A — activation governor gate (BEFORE any loops or registration).
  // Default: run when durable loops are enabled. Can be explicitly disabled
  // via runActivationGovernor=false (for memory-mode tests).
  const shouldRunActivation = typeof options.runActivationGovernor === 'boolean'
    ? options.runActivationGovernor
    : enableDurableLoops;
  if (shouldRunActivation) {
    try {
      await activationGovernor.activate();
    } catch (err) {
      telemetry.emit('distributed_runtime_stopped', {
        workerId: options.workerId,
        reason: 'activation_failed',
        error: (err as Error)?.message ?? String(err),
      });
      // No silent downgrade — surface the activation failure to the caller.
      if (err instanceof DistributedRuntimeActivationError) throw err;
      throw new Error(`distributed runtime activation failed: ${(err as Error)?.message ?? String(err)}`);
    }
  }

  // 1. Register worker.
  await workerCoord.register({
    workerId: options.workerId,
    workerKind: options.workerKind,
    capabilities: options.capabilities,
    hostname: options.hostname,
    processIdentity: options.processIdentity,
  });
  void queue; // referenced for type safety; actual usage by runner

  telemetry.emit('distributed_runtime_started', {
    workerId: options.workerId, workerKind: options.workerKind,
    capabilities: options.capabilities.map((c) => c.name),
    mode,
    activationGovernorRan: shouldRunActivation,
  });

  if (mode === 'oneshot') {
    // Single pass: register + run one loop pass + return.
    await runner.runLoop({
      workerId: options.workerId,
      builders: options.builders,
      maxIterations: options.maxIterationsPerLoop ?? 50,
      maxConcurrency: options.runnerConcurrency ?? 4,
      idleDelayMs: options.idleDelayMs ?? 250,
      visibilityMs: options.visibilityMs,
      leaseDurationMs: options.leaseDurationMs,
    });
    await workerCoord.offline(options.workerId);
    telemetry.emit('distributed_runtime_stopped', {
      workerId: options.workerId, mode: 'oneshot',
    });
    return {
      skipped: false, startedAtIso, reason: null,
      handle: { workerId: options.workerId, async stop() {}, isRunning() { return false; } },
    };
  }

  // Background mode: start loops in parallel via timers.
  let stopped = false;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let sweepTimer: NodeJS.Timeout | null = null;
  let recoveryTimer: NodeJS.Timeout | null = null;
  let replayTimer: NodeJS.Timeout | null = null;
  let compactionTimer: NodeJS.Timeout | null = null;
  let runnerLoopPromise: Promise<void> | null = null;

  // Heartbeat loop.
  function scheduleHeartbeat(): void {
    if (stopped) return;
    heartbeatTimer = setTimeout(async () => {
      try {
        const beat = await workerCoord.heartbeat({ workerId: options.workerId });
        telemetry.emit('distributed_runtime_heartbeat', {
          workerId: options.workerId, active: beat?.activeExecutionCount ?? 0,
        });
      } catch { /* swallow — heartbeat is best-effort */ }
      scheduleHeartbeat();
    }, heartbeatMs);
  }

  // Stale-worker sweep loop.
  function scheduleSweep(): void {
    if (stopped) return;
    sweepTimer = setTimeout(async () => {
      try {
        const sweepResult = await workerCoord.sweepStale();
        telemetry.emit('distributed_runtime_sweep', {
          markedStaleCount: sweepResult.markedStale.length,
        });
      } catch { /* ignore */ }
      scheduleSweep();
    }, sweepMs);
  }

  // Recovery scheduling tick loop.
  function scheduleRecoveryTick(): void {
    if (stopped) return;
    recoveryTimer = setTimeout(async () => {
      try {
        const findings = await reconciler.detect({ limit: 50 });
        if (findings.length > 0) {
          const result = await recoveryGovernor.scheduleStaleRecoveries({
            findings, maxSchedulePerCall: 25,
          });
          telemetry.emit('distributed_runtime_recovery_tick', {
            findings: findings.length,
            scheduled: result.scheduledExecutionIds.length,
            throttled: result.throttledExecutionIds.length,
            suppressed: result.suppressedExecutionIds.length,
          });
        }
      } catch { /* ignore */ }
      scheduleRecoveryTick();
    }, recoveryMs);
  }

  // Runner loop. We run a SINGLE call to runner.runLoop() with maxIterations
  // bounded; when it returns we re-enter unless stopped. This means each
  // call yields the event loop periodically for sweep/heartbeat/recovery.
  async function runnerLoop(): Promise<void> {
    while (!stopped && !runner.isStopRequested()) {
      try {
        await runner.runLoop({
          workerId: options.workerId,
          builders: options.builders,
          maxIterations: options.maxIterationsPerLoop ?? 200,
          maxConcurrency: options.runnerConcurrency ?? 4,
          idleDelayMs: options.idleDelayMs ?? 250,
          visibilityMs: options.visibilityMs,
          leaseDurationMs: options.leaseDurationMs,
        });
      } catch { /* swallow — re-enter unless stopped */ }
    }
  }

  // Phase 21J — durable queue replay loop (env-gated).
  function scheduleReplayTick(): void {
    if (stopped) return;
    replayTimer = setTimeout(async () => {
      try {
        const report = await replayCoord.runFullReplaySweep({ maxEntriesPerSweep: 200 });
        telemetry.emit('distributed_runtime_replay_tick', {
          reclaimed: report.reclaimedEntries.length,
          delayedReady: report.delayedReadyEntries.length,
          deadLetterCandidates: report.deadLetterCandidates.length,
          durationMs: report.durationMs,
        });
      } catch { /* ignore */ }
      scheduleReplayTick();
    }, replayMs);
  }

  // Phase 21J — runtime persistence compaction loop (env-gated).
  function scheduleCompactionTick(): void {
    if (stopped) return;
    compactionTimer = setTimeout(async () => {
      try {
        const report = await compactor.runCompactionPass({
          // Conservative defaults for the periodic compaction.
          retentionMs: 7 * 24 * 60 * 60 * 1_000,
          maxDeletionsPerCall: 5_000,
        });
        telemetry.emit('distributed_runtime_compaction_tick', {
          totalArchived: report.totalArchivedCount,
          durationMs: report.durationMs,
        });
      } catch { /* ignore */ }
      scheduleCompactionTick();
    }, compactionMs);
  }

  scheduleHeartbeat();
  scheduleSweep();
  scheduleRecoveryTick();
  if (enableDurableLoops) {
    scheduleReplayTick();
    scheduleCompactionTick();
  }
  runnerLoopPromise = runnerLoop();

  const handle: DistributedRuntimeHandle = {
    workerId: options.workerId,
    isRunning() { return !stopped; },
    async stop() {
      if (stopped) return;
      stopped = true;
      runner.stop();
      if (heartbeatTimer) clearTimeout(heartbeatTimer);
      if (sweepTimer) clearTimeout(sweepTimer);
      if (recoveryTimer) clearTimeout(recoveryTimer);
      if (replayTimer) clearTimeout(replayTimer);
      if (compactionTimer) clearTimeout(compactionTimer);
      // Wait for the runner loop to finish in-flight work.
      try { await runnerLoopPromise; } catch { /* swallow */ }

      // Phase 22F — graceful shutdown:
      // 1. Drain first so new claims refuse for this worker.
      // 2. Release any leases this worker still holds (defense in depth —
      //    the runner finally-block normally handles release, but a crash
      //    mid-shutdown leaves leases hanging).
      // 3. Mark offline (drain is already in place; this finalizes lifecycle).
      try { await workerCoord.drain(options.workerId); } catch { /* tolerated */ }

      // Release leases owned by this worker so a peer can take over fast.
      try {
        const store = getDefaultExecutionStore();
        const active = await store.listExecutions({ status: ['running', 'recovering', 'waiting'], limit: 200 });
        for (const exec of active) {
          if (exec.executionOwner !== options.workerId) continue;
          const lease = await store.currentLease(exec.executionId);
          if (lease && lease.ownerWorkerId === options.workerId && !lease.released) {
            try { await store.releaseLease(lease.leaseId); } catch { /* tolerated */ }
          }
        }
      } catch { /* lease cleanup is best-effort */ }

      try { await workerCoord.offline(options.workerId); } catch { /* tolerated */ }

      telemetry.emit('distributed_runtime_shutdown_drained', {
        workerId: options.workerId, mode: 'background',
      });
      telemetry.emit('distributed_runtime_stopped', {
        workerId: options.workerId, mode: 'background',
      });
    },
  };

  // Phase 22F — optional process-level shutdown signal binding.
  if (options.bindShutdownSignals) {
    const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
    for (const sig of signals) {
      process.once(sig, () => {
        if (stopped) return;
        try { void handle.stop(); } catch { /* swallow */ }
      });
    }
  }

  return { skipped: false, startedAtIso, handle, reason: null };
}

/**
 * Env-gated convenience helper. Use from boot entrypoints
 * (instrumentation.node.ts / startWorkers / cron). Skipped unless
 * ENABLE_DISTRIBUTED_EXECUTION_RUNTIME=1.
 */
export async function maybeStartDistributedRuntime<TCtx>(
  input: StartupDistributedRuntimeOptions<TCtx>,
): Promise<StartupDistributedRuntimeResult> {
  const enabled =
    process.env.ENABLE_DISTRIBUTED_EXECUTION_RUNTIME === '1' ||
    process.env.ENABLE_DISTRIBUTED_EXECUTION_RUNTIME === 'true';
  const telemetry = input.telemetry ?? defaultTelemetrySink;
  if (!enabled) {
    telemetry.emit('distributed_runtime_skipped', {
      workerId: input.workerId,
      reason: 'ENABLE_DISTRIBUTED_EXECUTION_RUNTIME not set',
    });
    return {
      skipped: true,
      startedAtIso: new Date().toISOString(),
      handle: null,
      reason: 'env_disabled',
    };
  }
  return startDistributedRuntime(input);
}

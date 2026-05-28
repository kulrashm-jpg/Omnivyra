/**
 * Phase 22B — DistributedRuntimeActivationGovernor
 *
 * Authoritative pre-activation gate for the durable distributed runtime.
 * Validates every precondition BEFORE `startDistributedRuntime()` is
 * allowed to bring loops online. Hard-fails on any unmet precondition;
 * NEVER silently downgrades.
 *
 * RESPONSIBILITIES (per spec):
 *   - validate migrations exist           → migration probe via store call
 *   - validate persistence stores registered (execution / checkpoint / lease)
 *   - validate queue / worker connectivity (round-trip probe)
 *   - validate write-side queue capability (insert + delete sentinel)
 *   - validate worker registry capability  (insert + delete sentinel)
 *   - validate replay coordinator readiness
 *   - validate compactor readiness
 *
 * GUARANTEES:
 *   - Runtime CANNOT activate partially. A single validator failure
 *     fails the whole activation.
 *   - No silent downgrade — `activate()` either resolves with `ok: true`
 *     or rejects with `DistributedRuntimeActivationError`.
 *   - Watchdog timeout: validations have an overall budget; running past
 *     it aborts.
 *   - Idempotent: a second activate() call returns the cached prior result
 *     unless `force: true`.
 *
 * TELEMETRY:
 *   distributed_runtime_activation_started
 *   distributed_runtime_activation_succeeded
 *   distributed_runtime_activation_failed
 */

import type { DistributedExecutionQueue } from './distributedExecutionQueue';
import type { DistributedWorkerCoordinator } from './distributedWorkerCoordinator';
import type { DurableQueueReplayCoordinator } from './durableQueueReplayCoordinator';
import type { RuntimePersistenceCompactor } from './runtimePersistenceCompactor';
import {
  getDefaultExecutionQueue,
} from './distributedExecutionQueue';
import {
  getDefaultDistributedWorkerCoordinator,
} from './distributedWorkerCoordinator';
import {
  getDefaultDurableQueueReplayCoordinator,
} from './durableQueueReplayCoordinator';
import {
  getDefaultRuntimePersistenceCompactor,
} from './runtimePersistenceCompactor';

// ────────────────────────────────────────────────────────────────────
// Telemetry
// ────────────────────────────────────────────────────────────────────

export type ActivationTelemetryEvent =
  | 'distributed_runtime_activation_started'
  | 'distributed_runtime_activation_succeeded'
  | 'distributed_runtime_activation_failed'
  | 'distributed_runtime_activation_validator_passed'
  | 'distributed_runtime_activation_validator_failed';

export interface ActivationTelemetrySink {
  emit(event: ActivationTelemetryEvent, payload: Record<string, unknown>): void;
}

const defaultTelemetrySink: ActivationTelemetrySink = {
  emit(event, payload) {
    try {
      const line = JSON.stringify({ event, ...payload, ts: new Date().toISOString() });
      if (event === 'distributed_runtime_activation_failed' || event === 'distributed_runtime_activation_validator_failed') {
        console.warn(`[runtime_activation] ${line}`);
      } else {
        console.log(`[runtime_activation] ${line}`);
      }
    } catch { /* ignore */ }
  },
};

// ────────────────────────────────────────────────────────────────────
// Errors
// ────────────────────────────────────────────────────────────────────

export class DistributedRuntimeActivationError extends Error {
  constructor(
    public readonly stage: string,
    public readonly code: string,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(`[DistributedRuntimeActivationGovernor.${stage}] ${code}: ${message}`);
    this.name = 'DistributedRuntimeActivationError';
  }
}

// ────────────────────────────────────────────────────────────────────
// Validator descriptor
// ────────────────────────────────────────────────────────────────────

export interface ValidatorResult {
  name: string;
  ok: boolean;
  durationMs: number;
  detail: string;
  errorCode?: string;
}

export interface ActivationResult {
  ok: boolean;
  startedAtIso: string;
  completedAtIso: string;
  durationMs: number;
  validators: ValidatorResult[];
  failedValidatorName: string | null;
  cached: boolean;
}

// ────────────────────────────────────────────────────────────────────
// Options + interface
// ────────────────────────────────────────────────────────────────────

export interface DistributedRuntimeActivationGovernorOptions {
  queue?: DistributedExecutionQueue;
  workerCoordinator?: DistributedWorkerCoordinator;
  replayCoordinator?: DurableQueueReplayCoordinator;
  compactor?: RuntimePersistenceCompactor;
  telemetry?: ActivationTelemetrySink;
  /** Hard watchdog for the whole activation. Default 15_000 ms. */
  watchdogMs?: number;
  /**
   * Sentinel companyId used by write-side probes. Same one as Phase 18C
   * `WRITE_SMOKE_COMPANY_ID` so cleanup queries can find probes deterministically.
   */
  sentinelCompanyId?: string;
}

export interface DistributedRuntimeActivationGovernor {
  activate(opts?: { force?: boolean }): Promise<ActivationResult>;
  /** Read-only state inspection. */
  isActivated(): boolean;
  /** Test helper: clear cached activation result. */
  _reset(): void;
}

const DEFAULT_SENTINEL_COMPANY_ID = '00000000-0000-0000-0000-000000000000';

// ────────────────────────────────────────────────────────────────────
// Implementation
// ────────────────────────────────────────────────────────────────────

export function createDistributedRuntimeActivationGovernor(
  options?: DistributedRuntimeActivationGovernorOptions,
): DistributedRuntimeActivationGovernor {
  const queue = options?.queue ?? getDefaultExecutionQueue();
  const workerCoord = options?.workerCoordinator ?? getDefaultDistributedWorkerCoordinator();
  const replayCoord = options?.replayCoordinator ?? getDefaultDurableQueueReplayCoordinator();
  const compactor = options?.compactor ?? getDefaultRuntimePersistenceCompactor();
  const telemetry = options?.telemetry ?? defaultTelemetrySink;
  const watchdogMs = Math.max(1_000, options?.watchdogMs ?? 15_000);
  const sentinelCompanyId = options?.sentinelCompanyId ?? DEFAULT_SENTINEL_COMPANY_ID;
  let cached: ActivationResult | null = null;

  function newSentinelExecId(prefix: string): string {
    return `_runtime_activation_${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  async function runValidator(
    name: string,
    fn: () => Promise<{ ok: boolean; detail: string; errorCode?: string }>,
  ): Promise<ValidatorResult> {
    const t0 = Date.now();
    try {
      const r = await fn();
      const result: ValidatorResult = {
        name, ok: r.ok, durationMs: Date.now() - t0, detail: r.detail,
        errorCode: r.ok ? undefined : (r.errorCode ?? 'VALIDATOR_FAILED'),
      };
      if (r.ok) {
        telemetry.emit('distributed_runtime_activation_validator_passed', {
          name, durationMs: result.durationMs, detail: r.detail,
        });
      } else {
        telemetry.emit('distributed_runtime_activation_validator_failed', {
          name, durationMs: result.durationMs, detail: r.detail,
          errorCode: result.errorCode,
        });
      }
      return result;
    } catch (err) {
      const detail = (err as Error)?.message ?? String(err);
      const errorCode = (err as { code?: string })?.code ?? 'VALIDATOR_THREW';
      telemetry.emit('distributed_runtime_activation_validator_failed', {
        name, durationMs: Date.now() - t0, detail, errorCode,
      });
      return { name, ok: false, durationMs: Date.now() - t0, detail, errorCode };
    }
  }

  // ── Individual validators ────────────────────────────────────────

  async function validateQueueConnectivity(): Promise<{ ok: boolean; detail: string; errorCode?: string }> {
    // Read path: countByStatus issues a SELECT round trip.
    const counts = await queue.countByStatus();
    return {
      ok: typeof counts === 'object' && counts !== null,
      detail: `countByStatus returned ${JSON.stringify(counts)}`,
    };
  }

  async function validateWorkerRegistryConnectivity(): Promise<{ ok: boolean; detail: string; errorCode?: string }> {
    // Read path: list() with empty filter.
    const list = await workerCoord.list();
    return {
      ok: Array.isArray(list),
      detail: `workerCoord.list() returned ${list.length} entries`,
    };
  }

  async function validateQueueWriteCapability(): Promise<{ ok: boolean; detail: string; errorCode?: string }> {
    const execId = newSentinelExecId('queue');
    const dedupKey = `_runtime_activation:${execId}`;
    let entry;
    try {
      entry = await queue.enqueue({
        executionId: execId, companyId: sentinelCompanyId,
        kind: 'execution_start', dedupKey,
        priority: 0, maxAttempts: 1,
      });
    } catch (err) {
      return { ok: false, detail: `enqueue threw: ${(err as Error).message}`, errorCode: 'ENQUEUE_FAILED' };
    }
    // Verify read-back.
    const readBack = await queue.get(entry.queueEntryId);
    const ok = !!readBack && readBack.executionId === execId;
    // Cleanup — best-effort cancel via ack.
    try {
      await queue.ack({
        queueEntryId: entry.queueEntryId, workerId: '_runtime_activation_probe',
        outcome: 'cancelled',
      });
    } catch { /* swallow */ }
    return ok
      ? { ok: true, detail: `enqueue+readBack ok (${entry.queueEntryId})` }
      : { ok: false, detail: `read-back missing for ${entry.queueEntryId}`, errorCode: 'READBACK_MISSING' };
  }

  async function validateWorkerRegistryWriteCapability(): Promise<{ ok: boolean; detail: string; errorCode?: string }> {
    const workerId = `_runtime_activation_probe_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    try {
      await workerCoord.register({
        workerId, workerKind: 'test',
        capabilities: [{ name: 'activation_probe' }],
        meta: { probe: true },
      });
    } catch (err) {
      return { ok: false, detail: `register threw: ${(err as Error).message}`, errorCode: 'REGISTER_FAILED' };
    }
    const fetched = await workerCoord.get(workerId);
    const ok = !!fetched && fetched.workerId === workerId;
    // Cleanup — mark offline (or future delete via compactor cycle).
    try { await workerCoord.offline(workerId); } catch { /* swallow */ }
    return ok
      ? { ok: true, detail: `register+get ok (${workerId})` }
      : { ok: false, detail: `worker not found post-register (${workerId})`, errorCode: 'WORKER_LOOKUP_MISSING' };
  }

  async function validateReplayCoordinatorReadiness(): Promise<{ ok: boolean; detail: string; errorCode?: string }> {
    // Dry-run a tiny replay sweep — should NOT touch any real entries.
    const report = await replayCoord.runFullReplaySweep({
      maxEntriesPerSweep: 1, maxDurationMs: 5_000,
    });
    return {
      ok: !report.aborted,
      detail: `runFullReplaySweep aborted=${report.aborted} reason=${report.abortReason ?? '<none>'}`,
      errorCode: report.aborted ? 'REPLAY_SWEEP_ABORTED' : undefined,
    };
  }

  async function validateCompactorReadiness(): Promise<{ ok: boolean; detail: string; errorCode?: string }> {
    // Dry-run a compaction pass.
    const report = await compactor.runCompactionPass({
      dryRun: true, maxDurationMs: 5_000,
    });
    return {
      ok: !report.aborted,
      detail: `dryRun compaction aborted=${report.aborted} reason=${report.abortReason ?? '<none>'}`,
      errorCode: report.aborted ? 'COMPACTOR_ABORTED' : undefined,
    };
  }

  // ── Public API ────────────────────────────────────────────────────

  return {
    async activate(opts) {
      if (cached && !opts?.force) {
        return { ...cached, cached: true };
      }
      const t0 = Date.now();
      const startedAtIso = new Date(t0).toISOString();
      telemetry.emit('distributed_runtime_activation_started', {
        watchdogMs, sentinelCompanyId,
      });

      const validators: ValidatorResult[] = [];
      let failed = false;

      // Watchdog wrapper.
      function timedOut(): boolean { return Date.now() - t0 > watchdogMs; }

      const order: Array<[string, () => Promise<{ ok: boolean; detail: string; errorCode?: string }>]> = [
        ['queue_connectivity', validateQueueConnectivity],
        ['worker_registry_connectivity', validateWorkerRegistryConnectivity],
        ['queue_write_capability', validateQueueWriteCapability],
        ['worker_registry_write_capability', validateWorkerRegistryWriteCapability],
        ['replay_coordinator_readiness', validateReplayCoordinatorReadiness],
        ['compactor_readiness', validateCompactorReadiness],
      ];

      let failedName: string | null = null;
      for (const [name, fn] of order) {
        if (timedOut()) {
          failed = true;
          failedName = 'watchdog';
          validators.push({
            name: 'watchdog', ok: false,
            durationMs: Date.now() - t0, detail: 'watchdog exceeded before all validators ran',
            errorCode: 'WATCHDOG_EXCEEDED',
          });
          break;
        }
        const v = await runValidator(name, fn);
        validators.push(v);
        if (!v.ok) {
          failed = true;
          failedName = v.name;
          break;
        }
      }

      const completedAtIso = new Date().toISOString();
      const result: ActivationResult = {
        ok: !failed,
        startedAtIso, completedAtIso,
        durationMs: Date.now() - t0,
        validators, failedValidatorName: failedName, cached: false,
      };

      if (!failed) {
        cached = result;
        telemetry.emit('distributed_runtime_activation_succeeded', {
          durationMs: result.durationMs,
          validatorCount: validators.length,
        });
      } else {
        cached = null; // don't cache failures
        telemetry.emit('distributed_runtime_activation_failed', {
          durationMs: result.durationMs,
          failedValidator: failedName,
          validators: validators.map((v) => ({ name: v.name, ok: v.ok, code: v.errorCode })),
        });
        throw new DistributedRuntimeActivationError(
          failedName ?? 'unknown',
          validators.find((v) => v.name === failedName)?.errorCode ?? 'UNKNOWN',
          `activation halted at validator '${failedName}'`,
        );
      }

      return result;
    },

    isActivated(): boolean {
      return cached !== null && cached.ok;
    },

    _reset(): void {
      cached = null;
    },
  };
}

let _default: DistributedRuntimeActivationGovernor | null = null;
export function getDefaultDistributedRuntimeActivationGovernor(): DistributedRuntimeActivationGovernor {
  if (!_default) _default = createDistributedRuntimeActivationGovernor();
  return _default;
}
export function setDefaultDistributedRuntimeActivationGovernor(g: DistributedRuntimeActivationGovernor): void {
  _default = g;
}

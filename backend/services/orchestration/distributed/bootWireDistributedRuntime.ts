/**
 * Phase 22A — Boot wiring helper.
 *
 * Single canonical adapter from the three authoritative boot surfaces
 * (Next.js instrumentation, BullMQ worker entry, cron entry) to
 * `maybeStartDistributedRuntime`. Centralises:
 *
 *   - workerId generation (per-process, includes pid + processKind)
 *   - default capability set per process kind
 *   - default tick intervals per process kind
 *   - shutdown signal binding (cron + worker only — instrumentation
 *     uses Next.js' own lifecycle)
 *
 * IDEMPOTENT: callable multiple times safely. The activation governor +
 * worker coordinator handle dedup; this helper just guards a per-process
 * flag so accidental double-import doesn't double-start.
 *
 * NO SIDE EFFECTS unless ENABLE_DURABLE_DISTRIBUTED_RUNTIME=1.
 */

import os from 'os';
import {
  maybeStartDistributedRuntime,
  type DistributedRuntimeHandle,
  type StartupDistributedRuntimeOptions,
} from './startupDistributedRuntime';
import type { WorkerCapability, WorkerKind } from './distributedTypes';
import type { RunnerStepBuilders } from './distributedExecutionRunner';
import {
  buildDistributedRunnerStepBuilders,
} from './distributedWorkflowExecutionBridge';
import {
  getDefaultWorkflowStepRegistry,
} from './workflowStepRegistry';

// Per-process guard so accidental double-wire (e.g. hot-reload, double
// import) doesn't start two runtimes.
const _wiredHandles = new Map<string, DistributedRuntimeHandle>();

export type BootProcessKind = 'nextjs_server' | 'worker' | 'cron' | 'standalone';

const KIND_TO_WORKER_KIND: Record<BootProcessKind, WorkerKind> = {
  nextjs_server: 'standalone',
  worker: 'queue_worker',
  cron: 'cron',
  standalone: 'standalone',
};

const KIND_TO_CAPABILITIES: Record<BootProcessKind, WorkerCapability[]> = {
  // The Next.js process should NOT poll the queue by default — it's
  // request-serving territory. We still register it so the registry shows
  // every live instance and stale-detection works across fleet.
  nextjs_server: [{ name: 'observer', weight: 0 }],
  worker: [{ name: 'all', weight: 1 }],
  cron: [{ name: 'recovery_scheduling', weight: 1 }],
  standalone: [{ name: 'all', weight: 1 }],
};

function makeWorkerId(kind: BootProcessKind): string {
  const host = (() => { try { return os.hostname(); } catch { return 'unknown'; } })();
  return `worker_${kind}_${host}_${process.pid}_${Date.now().toString(36)}`;
}

/**
 * No-op step builders for boot surfaces that DON'T consume the queue
 * (cron, nextjs_server observers). They return empty step arrays so the
 * runner short-circuits with no side effects.
 */
function noopStepBuilders<TCtx>(): RunnerStepBuilders<TCtx> {
  return {
    buildSteps: async () => [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    buildContext: async () => ({} as TCtx),
  };
}

/**
 * Decide which step builders a given process kind should use.
 *   - worker / standalone → real bridge (registry → hydrator → governor → continuity)
 *   - nextjs_server / cron → no-op
 *
 * Caller can override via `stepBuilders`; that takes precedence.
 */
function resolveStepBuilders<TCtx>(
  processKind: BootProcessKind,
  override?: RunnerStepBuilders<unknown>,
): RunnerStepBuilders<TCtx> {
  if (override) return override as RunnerStepBuilders<TCtx>;
  if (processKind === 'worker' || processKind === 'standalone') {
    // Phase 23I — pre-flight check: refuse to start when no real builders
    // are registered. The registry asserts at least one non-placeholder
    // entry; this throws cleanly so the boot surface can hard-fail.
    const registry = getDefaultWorkflowStepRegistry();
    registry.assertRealBuildersPresent();
    return buildDistributedRunnerStepBuilders<TCtx>();
  }
  return noopStepBuilders<TCtx>();
}

export interface WireDistributedRuntimeInput {
  processKind: BootProcessKind;
  /**
   * Caller-supplied step builders for processes that actually consume the
   * queue (worker / standalone). When omitted, no-op builders are used
   * (cron / nextjs_server). When `runActivationGovernor` is true (default
   * when durable loops are enabled) the activation governor still runs.
   */
  stepBuilders?: RunnerStepBuilders<unknown>;
  /** Override default per-kind capabilities. */
  capabilities?: WorkerCapability[];
  /** Override default ticks. */
  options?: Partial<StartupDistributedRuntimeOptions<unknown>>;
}

/**
 * Wire the distributed runtime for the given boot surface. Idempotent
 * per-process per-processKind. Returns the handle when active or null
 * when skipped (env disabled / already wired).
 */
export async function wireDistributedRuntime(
  input: WireDistributedRuntimeInput,
): Promise<DistributedRuntimeHandle | null> {
  const guardKey = `${input.processKind}:${process.pid}`;
  const existing = _wiredHandles.get(guardKey);
  if (existing) return existing;

  const workerKind = KIND_TO_WORKER_KIND[input.processKind];
  const capabilities = input.capabilities ?? KIND_TO_CAPABILITIES[input.processKind];

  const builders = resolveStepBuilders<unknown>(input.processKind, input.stepBuilders);

  const result = await maybeStartDistributedRuntime({
    workerId: makeWorkerId(input.processKind),
    workerKind,
    capabilities,
    builders,
    hostname: (() => { try { return os.hostname(); } catch { return undefined; } })(),
    processIdentity: `${input.processKind}:${process.pid}`,
    // Bind signal handlers on long-lived processes; not on Next.js
    // instrumentation (Next.js owns SIGINT/SIGTERM).
    bindShutdownSignals: input.processKind !== 'nextjs_server',
    ...(input.options ?? {}),
  });

  if (result.skipped || !result.handle) return null;
  _wiredHandles.set(guardKey, result.handle);
  return result.handle;
}

/** Test helper: clear the per-process wiring registry. */
export function _resetWiredDistributedRuntime(): void {
  _wiredHandles.clear();
}

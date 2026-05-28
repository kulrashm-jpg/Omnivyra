/**
 * Phase 23C — Distributed workflow execution bridge.
 *
 * Adapts the queue→workflow pipeline (hydrator → governor → continuity →
 * registry) into the `RunnerStepBuilders` shape the DistributedExecutionRunner
 * expects. This is the SINGLE CANONICAL path from a claimed queue entry to
 * a `ReplayableWorkflowStep[]`.
 *
 * Pipeline (per `buildSteps` / `buildContext` call):
 *
 *   1. Hydrate the payload (QueuePayloadHydrator)
 *      ─ on failure → emit telemetry + return [] (runner acks completed,
 *        avoids re-running broken payloads)
 *   2. Validate the payload semantics (ExecutionPayloadGovernor)
 *      ─ on refusal → return [] (same suppress semantics)
 *   3. Check continuity (QueueCheckpointContinuityCoordinator)
 *      ─ verdict.recommendedAction === 'suppress' → return [] (no-op)
 *      ─ verdict.recommendedAction === 'fail' → throw (runner acks failed)
 *   4. Dispatch to the registered builder (WorkflowStepRegistry.build)
 *      ─ on failure → throw (runner acks failed; queue retry policy kicks in)
 *
 * GUARANTEES:
 *   - Single canonical translation: every queue entry consumed via this
 *     bridge gets hydrated + validated + continuity-checked before any
 *     workflow step runs.
 *   - Deterministic step output: same payload + same execution state →
 *     same steps.
 *   - Replay-safe: bridge never mutates state. Mutations happen only inside
 *     workflow steps (which carry their own idempotency hints).
 *
 * TELEMETRY:
 *   workflow_execution_bridge_dispatch
 *   workflow_execution_bridge_suppressed
 *   workflow_execution_bridge_refused
 */

import type { RunnerStepBuilders } from './distributedExecutionRunner';
import type { QueuePayloadHydrator } from './queuePayloadHydrator';
import type { ExecutionPayloadGovernor } from './executionPayloadGovernor';
import type { QueueCheckpointContinuityCoordinator } from './queueCheckpointContinuityCoordinator';
import type { WorkflowStepRegistry } from './workflowStepRegistry';
import {
  getDefaultQueuePayloadHydrator,
} from './queuePayloadHydrator';
import {
  getDefaultExecutionPayloadGovernor,
} from './executionPayloadGovernor';
import {
  getDefaultQueueCheckpointContinuityCoordinator,
} from './queueCheckpointContinuityCoordinator';
import {
  getDefaultWorkflowStepRegistry,
} from './workflowStepRegistry';

// ────────────────────────────────────────────────────────────────────
// Telemetry
// ────────────────────────────────────────────────────────────────────

export type BridgeTelemetryEvent =
  | 'workflow_execution_bridge_dispatch'
  | 'workflow_execution_bridge_suppressed'
  | 'workflow_execution_bridge_refused'
  | 'workflow_execution_bridge_failed';

export interface BridgeTelemetrySink {
  emit(event: BridgeTelemetryEvent, payload: Record<string, unknown>): void;
}

const defaultTelemetrySink: BridgeTelemetrySink = {
  emit(event, payload) {
    try {
      const line = JSON.stringify({ event, ...payload, ts: new Date().toISOString() });
      if (event === 'workflow_execution_bridge_failed' || event === 'workflow_execution_bridge_refused') {
        console.warn(`[wf_bridge] ${line}`);
      } else {
        console.log(`[wf_bridge] ${line}`);
      }
    } catch { /* ignore */ }
  },
};

// ────────────────────────────────────────────────────────────────────
// Errors
// ────────────────────────────────────────────────────────────────────

export class WorkflowExecutionBridgeError extends Error {
  constructor(
    public readonly stage: 'hydrate' | 'validate' | 'continuity' | 'dispatch',
    public readonly code: string,
    message: string,
    public readonly queueEntryId: string,
  ) {
    super(`[WorkflowExecutionBridge.${stage}] ${code} for ${queueEntryId}: ${message}`);
    this.name = 'WorkflowExecutionBridgeError';
  }
}

// ────────────────────────────────────────────────────────────────────
// Bridge factory
// ────────────────────────────────────────────────────────────────────

export interface BuildDistributedRunnerBuildersOptions {
  hydrator?: QueuePayloadHydrator;
  governor?: ExecutionPayloadGovernor;
  continuity?: QueueCheckpointContinuityCoordinator;
  registry?: WorkflowStepRegistry;
  telemetry?: BridgeTelemetrySink;
}

/**
 * Build a `RunnerStepBuilders<TCtx>` instance that the
 * DistributedExecutionRunner can consume. TCtx is the registry's per-builder
 * context shape — generic to keep the runner agnostic.
 */
export function buildDistributedRunnerStepBuilders<TCtx>(
  options?: BuildDistributedRunnerBuildersOptions,
): RunnerStepBuilders<TCtx> {
  const hydrator = options?.hydrator ?? getDefaultQueuePayloadHydrator();
  const governor = options?.governor ?? getDefaultExecutionPayloadGovernor();
  const continuity = options?.continuity ?? getDefaultQueueCheckpointContinuityCoordinator();
  const registry = options?.registry ?? getDefaultWorkflowStepRegistry();
  const telemetry = options?.telemetry ?? defaultTelemetrySink;

  // We cache the most-recent build result per queue entry so the runner's
  // buildSteps + buildContext calls (which arrive back-to-back for the same
  // entry) share work. Cache size is 1 entry — the runner only calls
  // buildSteps then buildContext per claim.
  let lastBuild: {
    queueEntryId: string;
    steps: import('@/backend/services/orchestration/recovery/replayContinuationEngine').ReplayableWorkflowStep<TCtx>[];
    context: TCtx;
  } | null = null;

  async function dispatch(input: {
    queueEntry: import('./distributedTypes').QueueEntry;
  }): Promise<{ steps: import('@/backend/services/orchestration/recovery/replayContinuationEngine').ReplayableWorkflowStep<TCtx>[]; context: TCtx }> {
    if (lastBuild && lastBuild.queueEntryId === input.queueEntry.queueEntryId) {
      return { steps: lastBuild.steps, context: lastBuild.context };
    }
    const queueEntryId = input.queueEntry.queueEntryId;

    // Stage 1 — hydrate.
    const { hydrated, validation } = await hydrator.hydrateOrNull(input.queueEntry);
    if (!hydrated) {
      telemetry.emit('workflow_execution_bridge_refused', {
        queueEntryId, stage: 'hydrate',
        code: validation.code, detail: validation.detail,
      });
      // Surface as an error so the runner acks failed and the queue retry
      // policy can advance to dead-letter eventually.
      throw new WorkflowExecutionBridgeError(
        'hydrate', validation.code, validation.detail, queueEntryId,
      );
    }

    // Stage 2 — validate.
    const govVerdict = governor.validate(hydrated);
    if (!govVerdict.ok) {
      telemetry.emit('workflow_execution_bridge_refused', {
        queueEntryId, stage: 'validate',
        code: govVerdict.code, detail: govVerdict.detail,
      });
      throw new WorkflowExecutionBridgeError(
        'validate', govVerdict.code, govVerdict.detail, queueEntryId,
      );
    }

    // Stage 3 — continuity.
    const cont = continuity.validate(hydrated);
    if (cont.recommendedAction === 'suppress') {
      telemetry.emit('workflow_execution_bridge_suppressed', {
        queueEntryId, stage: 'continuity',
        code: cont.code, detail: cont.detail,
      });
      // Return empty steps so the runner's downstream recovery coord
      // short-circuits — the queue entry is acked as completed and the
      // execution state is unchanged. The idempotency governor + checkpoint
      // chain already guard duplicate side effects.
      const empty = { steps: [], context: {} as TCtx };
      lastBuild = { queueEntryId, ...empty };
      return empty;
    }
    if (cont.recommendedAction === 'fail') {
      telemetry.emit('workflow_execution_bridge_refused', {
        queueEntryId, stage: 'continuity',
        code: cont.code, detail: cont.detail,
      });
      throw new WorkflowExecutionBridgeError(
        'continuity', cont.code, cont.detail, queueEntryId,
      );
    }

    // Stage 4 — dispatch to the registered builder.
    try {
      const out = await registry.build<TCtx>(hydrated);
      telemetry.emit('workflow_execution_bridge_dispatch', {
        queueEntryId,
        workflowType: hydrated.payload.workflowType,
        stepCount: out.steps.length,
        chainLength: hydrated.restored?.chain.length ?? 0,
      });
      lastBuild = { queueEntryId, steps: out.steps, context: out.context };
      return out;
    } catch (err) {
      telemetry.emit('workflow_execution_bridge_failed', {
        queueEntryId, stage: 'dispatch',
        error: (err as Error)?.message ?? String(err),
      });
      throw new WorkflowExecutionBridgeError(
        'dispatch',
        (err as { code?: string })?.code ?? 'BUILD_FAILED',
        (err as Error)?.message ?? 'unknown',
        queueEntryId,
      );
    }
  }

  return {
    async buildSteps(input) {
      const r = await dispatch({ queueEntry: input.queueEntry });
      return r.steps;
    },
    async buildContext(input) {
      const r = await dispatch({ queueEntry: input.queueEntry });
      return r.context;
    },
  };
}

/**
 * Phase 23A — WorkflowStepRegistry
 *
 * Single canonical lookup table from `workflowType` → `WorkflowStepBuilder`.
 * Each authoritative process registers its builders during boot wiring;
 * the distributed runner consults the registry to translate queue payloads
 * into resumable workflow steps.
 *
 * SCOPE: registration + lookup ONLY. No orchestration semantics, no
 * payload validation (delegated to QueuePayloadHydrator + ExecutionPayloadGovernor).
 *
 * GUARANTEES:
 *   - Single canonical path: every queue payload routes through
 *     `registry.build(hydrated)` — no alternate code path exists.
 *   - Deterministic: same workflowType → same builder. Re-registration
 *     overwrites the prior entry (operators can update the wiring
 *     between boots; per-process there's exactly one builder per type).
 *   - Bounded: registry size is the number of WorkflowType values.
 *   - Stable telemetry on every build dispatch.
 */

import type {
  HydratedQueuePayload,
  WorkflowStepBuilder,
  WorkflowStepBuilderOutput,
  WorkflowType,
} from './workflowExecutionTypes';

// ────────────────────────────────────────────────────────────────────
// Telemetry
// ────────────────────────────────────────────────────────────────────

export type RegistryTelemetryEvent =
  | 'workflow_builder_registered'
  | 'workflow_builder_dispatch_started'
  | 'workflow_builder_dispatch_succeeded'
  | 'workflow_builder_dispatch_failed'
  | 'workflow_builder_missing';

export interface RegistryTelemetrySink {
  emit(event: RegistryTelemetryEvent, payload: Record<string, unknown>): void;
}

const defaultTelemetrySink: RegistryTelemetrySink = {
  emit(event, payload) {
    try {
      const line = JSON.stringify({ event, ...payload, ts: new Date().toISOString() });
      if (event === 'workflow_builder_missing' || event === 'workflow_builder_dispatch_failed') {
        console.warn(`[workflow_registry] ${line}`);
      } else {
        console.log(`[workflow_registry] ${line}`);
      }
    } catch { /* ignore */ }
  },
};

// ────────────────────────────────────────────────────────────────────
// Errors
// ────────────────────────────────────────────────────────────────────

export class WorkflowStepRegistryError extends Error {
  constructor(
    public readonly code: 'NO_BUILDER' | 'BUILD_FAILED' | 'INVALID_HYDRATED' | 'PLACEHOLDER_DETECTED',
    message: string,
    public readonly cause?: unknown,
  ) {
    super(`[WorkflowStepRegistry] ${code}: ${message}`);
    this.name = 'WorkflowStepRegistryError';
  }
}

// ────────────────────────────────────────────────────────────────────
// Registry interface
// ────────────────────────────────────────────────────────────────────

export interface WorkflowStepRegistry {
  register(builder: WorkflowStepBuilder): void;
  /** Returns the registered builder or null. */
  get(workflowType: WorkflowType): WorkflowStepBuilder | null;
  /** Read-only inspection. */
  list(): WorkflowStepBuilder[];
  /**
   * Dispatch — looks up the builder by hydrated.payload.workflowType and
   * invokes it. Throws WorkflowStepRegistryError on missing builder.
   */
  build<TCtx>(hydrated: HydratedQueuePayload): Promise<WorkflowStepBuilderOutput<TCtx>>;
  /** Phase 23I: assert that at least one non-placeholder builder is registered. */
  assertRealBuildersPresent(): void;
  /** Test helper: clear all registrations. */
  _reset(): void;
}

// ────────────────────────────────────────────────────────────────────
// Implementation
// ────────────────────────────────────────────────────────────────────

export interface WorkflowStepRegistryOptions {
  telemetry?: RegistryTelemetrySink;
}

/**
 * Marker tag for placeholder builders. The bootWireDistributedRuntime
 * hardening (Phase 23I) refuses to start when ALL registered builders
 * carry this tag, preventing "distributed runtime started with no real
 * orchestration wired" failures.
 */
export const PLACEHOLDER_BUILDER_TAG = '_placeholder';

export function createWorkflowStepRegistry(options?: WorkflowStepRegistryOptions): WorkflowStepRegistry {
  const telemetry = options?.telemetry ?? defaultTelemetrySink;
  const byType = new Map<WorkflowType, WorkflowStepBuilder>();

  return {
    register(builder) {
      if (!builder || !builder.workflowType) {
        throw new WorkflowStepRegistryError('NO_BUILDER', 'builder.workflowType required');
      }
      byType.set(builder.workflowType, builder);
      telemetry.emit('workflow_builder_registered', {
        workflowType: builder.workflowType,
        name: builder.name,
        isPlaceholder: builder.name.startsWith(PLACEHOLDER_BUILDER_TAG),
      });
    },

    get(workflowType) {
      return byType.get(workflowType) ?? null;
    },

    list() {
      return Array.from(byType.values());
    },

    async build<TCtx>(hydrated: HydratedQueuePayload): Promise<WorkflowStepBuilderOutput<TCtx>> {
      if (!hydrated || !hydrated.payload || !hydrated.queueEntry || !hydrated.execution) {
        throw new WorkflowStepRegistryError('INVALID_HYDRATED', 'hydrated payload missing required fields');
      }
      const wf = hydrated.payload.workflowType;
      const builder = byType.get(wf);
      if (!builder) {
        telemetry.emit('workflow_builder_missing', {
          workflowType: wf,
          executionId: hydrated.payload.executionId,
          queueEntryId: hydrated.queueEntry.queueEntryId,
        });
        throw new WorkflowStepRegistryError(
          'NO_BUILDER',
          `no builder registered for workflowType='${wf}'`,
        );
      }
      telemetry.emit('workflow_builder_dispatch_started', {
        workflowType: wf, builderName: builder.name,
        executionId: hydrated.payload.executionId,
        queueEntryId: hydrated.queueEntry.queueEntryId,
      });
      try {
        const out = await (builder as WorkflowStepBuilder<TCtx>).build({ hydrated });
        telemetry.emit('workflow_builder_dispatch_succeeded', {
          workflowType: wf, builderName: builder.name,
          stepCount: out.steps.length,
          executionId: hydrated.payload.executionId,
        });
        return out;
      } catch (err) {
        telemetry.emit('workflow_builder_dispatch_failed', {
          workflowType: wf, builderName: builder.name,
          executionId: hydrated.payload.executionId,
          error: (err as Error)?.message ?? String(err),
        });
        throw new WorkflowStepRegistryError(
          'BUILD_FAILED',
          `builder for '${wf}' threw: ${(err as Error)?.message ?? String(err)}`,
          err,
        );
      }
    },

    assertRealBuildersPresent() {
      const registered = Array.from(byType.values());
      if (registered.length === 0) {
        throw new WorkflowStepRegistryError(
          'NO_BUILDER',
          'no workflow step builders registered',
        );
      }
      const allPlaceholders = registered.every((b) => b.name.startsWith(PLACEHOLDER_BUILDER_TAG));
      if (allPlaceholders) {
        throw new WorkflowStepRegistryError(
          'PLACEHOLDER_DETECTED',
          'all registered builders are placeholders; refusing to start the distributed runtime',
        );
      }
    },

    _reset() {
      byType.clear();
    },
  };
}

// ────────────────────────────────────────────────────────────────────
// Default singleton
// ────────────────────────────────────────────────────────────────────

let _default: WorkflowStepRegistry | null = null;
export function getDefaultWorkflowStepRegistry(): WorkflowStepRegistry {
  if (!_default) _default = createWorkflowStepRegistry();
  return _default;
}
export function setDefaultWorkflowStepRegistry(r: WorkflowStepRegistry): void {
  _default = r;
}

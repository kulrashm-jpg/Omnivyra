/**
 * Phase 23C — Default distributed step builders.
 *
 * Built-in `WorkflowStepBuilder` implementations for the four supported
 * workflow types. These are GENERIC and meant to be either:
 *   - used as-is in test + memory-mode environments
 *   - replaced by operator-supplied builders that wire into the real
 *     campaign / longform / content-generation services
 *
 * Each builder:
 *   - reads `hydrated.payload.workflowParams` for its inputs
 *   - constructs a ReplayableWorkflowStep[] that uses stable step ids
 *   - attaches `idempotency` hints when the payload supplies them
 *   - tolerates an empty pending-set by returning [] (the runner's
 *     downstream recovery coordinator will short-circuit via
 *     "already_completed")
 *
 * The IDs each builder uses are STABLE across replays — same payload →
 * same step IDs → the resumable workflow engine's skip-on-completed path
 * keeps replays idempotent.
 */

import type {
  HydratedQueuePayload,
  ReplayableWorkflowStep,
  WorkflowStepBuilder,
  WorkflowStepBuilderInput,
  WorkflowStepBuilderOutput,
  WorkflowType,
} from './workflowExecutionTypes';

// ────────────────────────────────────────────────────────────────────
// Context shapes
// ────────────────────────────────────────────────────────────────────

/**
 * Default context object passed to every step. Builders can augment via
 * `workflowParams.context`; without that, steps receive this minimal shape.
 */
export interface DefaultWorkflowContext {
  executionId: string;
  companyId: string;
  workflowType: WorkflowType;
  workflowParams: Record<string, unknown>;
}

function baseContext(hydrated: HydratedQueuePayload): DefaultWorkflowContext {
  return {
    executionId: hydrated.payload.executionId,
    companyId: hydrated.payload.companyId,
    workflowType: hydrated.payload.workflowType,
    workflowParams: hydrated.payload.workflowParams ?? {},
  };
}

function attachIdempotency<TCtx>(
  steps: ReplayableWorkflowStep<TCtx>[],
  hydrated: HydratedQueuePayload,
): ReplayableWorkflowStep<TCtx>[] {
  const hints = hydrated.payload.idempotencyHints ?? [];
  if (hints.length === 0) return steps;
  const byStepId = new Map(hints.map((h) => [h.stepId, h]));
  return steps.map((s) => {
    const hint = byStepId.get(s.id);
    if (!hint) return s;
    return { ...s, idempotency: { cls: hint.cls, semanticParts: hint.semanticParts } };
  });
}

// ────────────────────────────────────────────────────────────────────
// Built-in builders
// ────────────────────────────────────────────────────────────────────

/**
 * Builder for `content_generation` workflows. Constructs a step per
 * `workflowParams.stepIds` entry. Default phases: 'generation' for the
 * first half, 'finalize' for the rest.
 */
export const defaultContentGenerationBuilder: WorkflowStepBuilder<DefaultWorkflowContext> = {
  workflowType: 'content_generation',
  name: 'default_content_generation_builder',
  async build(input: WorkflowStepBuilderInput<DefaultWorkflowContext>): Promise<WorkflowStepBuilderOutput<DefaultWorkflowContext>> {
    const stepIds = readStringArray(input.hydrated.payload.workflowParams?.stepIds);
    const handler = input.hydrated.payload.workflowParams?.handler;
    const onStep = typeof handler === 'function' ? handler : null;
    const steps: ReplayableWorkflowStep<DefaultWorkflowContext>[] = stepIds.map((id, idx) => ({
      id,
      phase: idx < stepIds.length / 2 ? 'generation' : 'finalize',
      async run(ctx) {
        if (onStep) await (onStep as (ctx: DefaultWorkflowContext, stepId: string) => Promise<void>)(ctx, id);
      },
    }));
    return {
      steps: attachIdempotency(steps, input.hydrated),
      context: baseContext(input.hydrated),
    };
  },
};

/**
 * Builder for `recovery` workflows. Reads `workflowParams.recoverySteps`
 * as the step manifest. Defaults all steps to the 'recovery' phase.
 */
export const defaultRecoveryBuilder: WorkflowStepBuilder<DefaultWorkflowContext> = {
  workflowType: 'recovery',
  name: 'default_recovery_builder',
  async build(input) {
    const stepIds = readStringArray(input.hydrated.payload.workflowParams?.recoverySteps);
    const handler = input.hydrated.payload.workflowParams?.handler;
    const onStep = typeof handler === 'function' ? handler : null;
    const steps: ReplayableWorkflowStep<DefaultWorkflowContext>[] = stepIds.map((id) => ({
      id, phase: 'recovery',
      async run(ctx) {
        if (onStep) await (onStep as (ctx: DefaultWorkflowContext, stepId: string) => Promise<void>)(ctx, id);
      },
    }));
    return {
      steps: attachIdempotency(steps, input.hydrated),
      context: baseContext(input.hydrated),
    };
  },
};

/**
 * Builder for `replay_continuation`. Pulls pendingNodeOperationIds from
 * the restored checkpoint when no explicit step list is provided.
 */
export const defaultReplayContinuationBuilder: WorkflowStepBuilder<DefaultWorkflowContext> = {
  workflowType: 'replay_continuation',
  name: 'default_replay_continuation_builder',
  async build(input) {
    let stepIds = readStringArray(input.hydrated.payload.workflowParams?.stepIds);
    if (stepIds.length === 0 && input.hydrated.restored) {
      stepIds = input.hydrated.restored.pendingNodeOperationIds;
    }
    const phase = (input.hydrated.restored?.phase ?? 'generation') as ReplayableWorkflowStep<unknown>['phase'];
    const handler = input.hydrated.payload.workflowParams?.handler;
    const onStep = typeof handler === 'function' ? handler : null;
    const steps: ReplayableWorkflowStep<DefaultWorkflowContext>[] = stepIds.map((id) => ({
      id, phase,
      async run(ctx) {
        if (onStep) await (onStep as (ctx: DefaultWorkflowContext, stepId: string) => Promise<void>)(ctx, id);
      },
    }));
    return {
      steps: attachIdempotency(steps, input.hydrated),
      context: baseContext(input.hydrated),
    };
  },
};

/**
 * Builder for `topology_mutation`. Reads `workflowParams.mutations` and
 * generates one step per mutation id. Phase: 'topology_settle'.
 */
export const defaultTopologyMutationBuilder: WorkflowStepBuilder<DefaultWorkflowContext> = {
  workflowType: 'topology_mutation',
  name: 'default_topology_mutation_builder',
  async build(input) {
    const mutations = readStringArray(input.hydrated.payload.workflowParams?.mutations);
    const handler = input.hydrated.payload.workflowParams?.handler;
    const onStep = typeof handler === 'function' ? handler : null;
    const steps: ReplayableWorkflowStep<DefaultWorkflowContext>[] = mutations.map((id) => ({
      id, phase: 'topology_settle',
      async run(ctx) {
        if (onStep) await (onStep as (ctx: DefaultWorkflowContext, stepId: string) => Promise<void>)(ctx, id);
      },
    }));
    return {
      steps: attachIdempotency(steps, input.hydrated),
      context: baseContext(input.hydrated),
    };
  },
};

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

function readStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === 'string');
}

// ────────────────────────────────────────────────────────────────────
// Convenience: register all four default builders into a registry.
// ────────────────────────────────────────────────────────────────────

import type { WorkflowStepRegistry } from './workflowStepRegistry';

export function registerDefaultDistributedStepBuilders(registry: WorkflowStepRegistry): void {
  registry.register(defaultContentGenerationBuilder as WorkflowStepBuilder);
  registry.register(defaultRecoveryBuilder as WorkflowStepBuilder);
  registry.register(defaultReplayContinuationBuilder as WorkflowStepBuilder);
  registry.register(defaultTopologyMutationBuilder as WorkflowStepBuilder);
}

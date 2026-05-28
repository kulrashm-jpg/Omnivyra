/**
 * Phase 24D — ProviderReconciliationWorkflowStepBuilder
 *
 * Translates queue payloads with `workflowType='provider_reconciliation'`
 * into a replay-safe step sequence:
 *
 *   1. fetch_provider_state       (phase: precheck; optional)
 *   2. drift_analysis             (phase: generation; optional)
 *   3. reconcile_row              (phase: persistence)
 *   4. reconciliation_snapshot    (phase: finalize; optional)
 *
 * GUARANTEES:
 *   - Reconciliation execution is now queue-driven + resumable.
 *   - Stable step IDs: `rec_fetch`, `rec_drift`, `rec_apply_<rowId>`,
 *     `rec_snapshot`.
 *   - Per-row idempotency on (rowId, provider): re-running a reconcile
 *     on the same (rowId, provider) is suppressed.
 *   - The CALLER injects the `runReconcileRow` hook (typically wired
 *     into the existing `reconcileRow()` service); the builder never
 *     touches provider state directly.
 */

import type {
  HydratedQueuePayload,
  ReplayableWorkflowStep,
  WorkflowStepBuilder,
  WorkflowStepBuilderInput,
  WorkflowStepBuilderOutput,
} from '../workflowExecutionTypes';
import type {
  ReconciliationContext,
  ReconciliationServiceHooks,
  ReconciliationWorkflowParams,
  SocialPlatform,
} from './domainWorkflowTypes';

export class ReconciliationBuilderError extends Error {
  constructor(public readonly code: string, message: string) {
    super(`[ProviderReconciliationWorkflowStepBuilder] ${code}: ${message}`);
    this.name = 'ReconciliationBuilderError';
  }
}

export const RECONCILIATION_STEP_IDS = {
  fetch: 'rec_fetch',
  drift: 'rec_drift',
  apply: (rowId: string) => `rec_apply_${rowId}`,
  snapshot: 'rec_snapshot',
} as const;

const VALID_PLATFORMS: ReadonlySet<SocialPlatform> = new Set<SocialPlatform>([
  'x', 'linkedin', 'instagram', 'facebook',
  'tiktok', 'youtube', 'pinterest', 'reddit', 'spotify',
]);

export interface CreateProviderReconciliationWorkflowStepBuilderOptions {
  serviceHooks: ReconciliationServiceHooks;
  name?: string;
}

export function createProviderReconciliationWorkflowStepBuilder(
  options: CreateProviderReconciliationWorkflowStepBuilderOptions,
): WorkflowStepBuilder<ReconciliationContext> {
  if (!options || !options.serviceHooks || typeof options.serviceHooks.runReconcileRow !== 'function') {
    throw new ReconciliationBuilderError('MISSING_HOOK', 'runReconcileRow hook required');
  }
  const hooks = options.serviceHooks;
  const builderName = options.name ?? 'provider_reconciliation_builder';

  return {
    workflowType: 'provider_reconciliation',
    name: builderName,
    async build(input: WorkflowStepBuilderInput<ReconciliationContext>): Promise<WorkflowStepBuilderOutput<ReconciliationContext>> {
      const params = readParams(input.hydrated);
      const ctx: ReconciliationContext = {
        executionId: input.hydrated.payload.executionId,
        rowId: params.rowId,
        provider: params.provider,
      };

      const steps: ReplayableWorkflowStep<ReconciliationContext>[] = [];

      if (hooks.runFetchProviderState) {
        steps.push({
          id: RECONCILIATION_STEP_IDS.fetch,
          phase: 'precheck',
          async run(c) { await hooks.runFetchProviderState!(c); },
        });
      }

      if (hooks.runDriftAnalysis) {
        steps.push({
          id: RECONCILIATION_STEP_IDS.drift,
          phase: 'generation',
          async run(c) { await hooks.runDriftAnalysis!(c); },
        });
      }

      steps.push({
        id: RECONCILIATION_STEP_IDS.apply(params.rowId),
        phase: 'persistence',
        idempotency: {
          cls: 'recovery_action',
          semanticParts: ['rec', params.provider, params.rowId],
        },
        async run(c) {
          await hooks.runReconcileRow(c);
        },
      });

      if (params.takeSnapshot !== false && hooks.runReconciliationSnapshot) {
        steps.push({
          id: RECONCILIATION_STEP_IDS.snapshot,
          phase: 'finalize',
          idempotency: {
            cls: 'unknown',
            semanticParts: ['rec_snap', params.provider, params.rowId],
          },
          async run(c) { await hooks.runReconciliationSnapshot!(c); },
        });
      }

      return { steps, context: ctx };
    },
  };
}

function readParams(hydrated: HydratedQueuePayload): ReconciliationWorkflowParams {
  const raw = (hydrated.payload.workflowParams ?? {}) as Record<string, unknown>;
  if (typeof raw.subType === 'string' && raw.subType !== 'provider_reconciliation') {
    throw new ReconciliationBuilderError('SUBTYPE_MISMATCH', `expected 'provider_reconciliation', got '${raw.subType}'`);
  }
  if (typeof raw.rowId !== 'string' || raw.rowId.length === 0) {
    throw new ReconciliationBuilderError('MISSING_FIELD', 'rowId required');
  }
  const provider = typeof raw.provider === 'string' ? raw.provider : '';
  if (!VALID_PLATFORMS.has(provider as SocialPlatform)) {
    throw new ReconciliationBuilderError('INVALID_PROVIDER', `unknown provider='${provider}'`);
  }
  return {
    subType: 'provider_reconciliation',
    rowId: raw.rowId,
    provider: provider as SocialPlatform,
    driftAnalysisHint: Array.isArray(raw.driftAnalysisHint)
      ? (raw.driftAnalysisHint as unknown[]).filter((v): v is string => typeof v === 'string')
      : undefined,
    takeSnapshot: typeof raw.takeSnapshot === 'boolean' ? raw.takeSnapshot : true,
  };
}

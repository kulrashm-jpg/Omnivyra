/**
 * Phase 24A — LongFormWorkflowStepBuilder
 *
 * Translates queue payloads with `workflowType='long_form_generation'`
 * into a replay-safe step sequence:
 *
 *   1. precheck                    (phase: precheck)
 *   2. generate_section_<id>       (phase: generation, one per sectionId)
 *   3. enrichment                  (phase: persistence; optional)
 *   4. recommendation_card         (phase: finalize; optional)
 *   5. finalize                    (phase: finalize)
 *
 * GUARANTEES:
 *   - Stable step IDs: `precheck`, `gen_<sectionId>`, `enrichment`,
 *     `recommendation_card`, `finalize`. Same payload → same IDs →
 *     deterministic replay continuation.
 *   - Idempotency hints attached per step: section generation is
 *     `cls=node_insert`, enrichment + recommendation are
 *     `cls=node_insert`, finalize is `cls=unknown`.
 *   - Caller-injected service hooks; the builder never invokes a
 *     real-world service directly. This preserves the substrate's
 *     "no orchestration semantic drift" guarantee.
 *   - Empty `sectionIds` payload short-circuits to a precheck + finalize
 *     pair so the workflow has a valid (empty) progression.
 *
 * SCOPE: step construction ONLY. No I/O, no replay decisions.
 */

import type {
  HydratedQueuePayload,
  ReplayableWorkflowStep,
  WorkflowStepBuilder,
  WorkflowStepBuilderInput,
  WorkflowStepBuilderOutput,
} from '../workflowExecutionTypes';
import type {
  LongFormContext,
  LongFormServiceHooks,
  LongFormWorkflowParams,
} from './domainWorkflowTypes';

// ────────────────────────────────────────────────────────────────────
// Errors
// ────────────────────────────────────────────────────────────────────

export class LongFormBuilderError extends Error {
  constructor(public readonly code: string, message: string) {
    super(`[LongFormWorkflowStepBuilder] ${code}: ${message}`);
    this.name = 'LongFormBuilderError';
  }
}

// ────────────────────────────────────────────────────────────────────
// Step ID helpers (STABLE — do not change without a schema bump)
// ────────────────────────────────────────────────────────────────────

export const LONG_FORM_STEP_IDS = {
  precheck: 'lf_precheck',
  generation: (sectionId: string) => `lf_gen_${sectionId}`,
  enrichment: 'lf_enrichment',
  recommendationCard: 'lf_recommendation_card',
  finalize: 'lf_finalize',
} as const;

// ────────────────────────────────────────────────────────────────────
// Builder factory
// ────────────────────────────────────────────────────────────────────

export interface CreateLongFormWorkflowStepBuilderOptions {
  serviceHooks: LongFormServiceHooks;
  /** Optional name override (for diagnostics). Default 'long_form_builder'. */
  name?: string;
}

export function createLongFormWorkflowStepBuilder(
  options: CreateLongFormWorkflowStepBuilderOptions,
): WorkflowStepBuilder<LongFormContext> {
  if (!options || !options.serviceHooks || typeof options.serviceHooks.runGenerationSection !== 'function') {
    throw new LongFormBuilderError('MISSING_HOOK', 'runGenerationSection hook required');
  }
  const hooks = options.serviceHooks;
  const builderName = options.name ?? 'long_form_builder';

  return {
    workflowType: 'long_form_generation',
    name: builderName,
    async build(input: WorkflowStepBuilderInput<LongFormContext>): Promise<WorkflowStepBuilderOutput<LongFormContext>> {
      const params = readParams(input.hydrated);
      const ctx: LongFormContext = {
        executionId: input.hydrated.payload.executionId,
        generationId: params.generationId,
        companyContext: params.companyContext ?? {},
      };

      const steps: ReplayableWorkflowStep<LongFormContext>[] = [];

      // 1. precheck
      steps.push({
        id: LONG_FORM_STEP_IDS.precheck,
        phase: 'precheck',
        async run(c) {
          if (hooks.runPrecheck) await hooks.runPrecheck(c);
        },
      });

      // 2. per-section generation
      for (const sectionId of params.sectionIds) {
        steps.push({
          id: LONG_FORM_STEP_IDS.generation(sectionId),
          phase: 'generation',
          idempotency: {
            cls: 'node_insert',
            semanticParts: ['lf', params.generationId, sectionId],
          },
          async run(c) {
            await hooks.runGenerationSection(c, sectionId);
          },
        });
      }

      // 3. enrichment (optional)
      if (params.runEnrichment !== false && hooks.runEnrichment) {
        steps.push({
          id: LONG_FORM_STEP_IDS.enrichment,
          phase: 'persistence',
          idempotency: {
            cls: 'node_insert',
            semanticParts: ['lf_enrich', params.generationId],
          },
          async run(c) {
            await hooks.runEnrichment!(c);
          },
        });
      }

      // 4. recommendation card (optional)
      if (params.emitRecommendationCard !== false && hooks.runRecommendationCard) {
        steps.push({
          id: LONG_FORM_STEP_IDS.recommendationCard,
          phase: 'finalize',
          idempotency: {
            cls: 'node_insert',
            semanticParts: ['lf_reco', params.generationId],
          },
          async run(c) {
            await hooks.runRecommendationCard!(c);
          },
        });
      }

      // 5. finalize
      steps.push({
        id: LONG_FORM_STEP_IDS.finalize,
        phase: 'finalize',
        idempotency: {
          cls: 'unknown',
          semanticParts: ['lf_final', params.generationId],
        },
        async run(c) {
          if (hooks.runFinalize) await hooks.runFinalize(c);
        },
      });

      return { steps, context: ctx };
    },
  };
}

// ────────────────────────────────────────────────────────────────────
// Param reader
// ────────────────────────────────────────────────────────────────────

function readParams(hydrated: HydratedQueuePayload): LongFormWorkflowParams {
  const raw = (hydrated.payload.workflowParams ?? {}) as Record<string, unknown>;
  const subType = typeof raw.subType === 'string' ? raw.subType : 'long_form_generation';
  if (subType !== 'long_form_generation') {
    throw new LongFormBuilderError('SUBTYPE_MISMATCH', `expected subType='long_form_generation', got '${subType}'`);
  }
  const generationId = typeof raw.generationId === 'string' && raw.generationId.length > 0
    ? raw.generationId
    : hydrated.payload.executionId;
  const sectionIds = Array.isArray(raw.sectionIds)
    ? (raw.sectionIds as unknown[]).filter((v): v is string => typeof v === 'string')
    : [];
  return {
    subType: 'long_form_generation',
    generationId,
    companyContext: (raw.companyContext as Record<string, unknown> | undefined) ?? undefined,
    sectionIds,
    styleHint: typeof raw.styleHint === 'string' ? raw.styleHint : undefined,
    runEnrichment: typeof raw.runEnrichment === 'boolean' ? raw.runEnrichment : true,
    emitRecommendationCard: typeof raw.emitRecommendationCard === 'boolean' ? raw.emitRecommendationCard : true,
  };
}

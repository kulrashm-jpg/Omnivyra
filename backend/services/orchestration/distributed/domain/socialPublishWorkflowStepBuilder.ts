/**
 * Phase 24C — SocialPublishWorkflowStepBuilder
 *
 * Translates queue payloads with `workflowType='social_publish'` into a
 * replay-safe step sequence:
 *
 *   1. publish_validate                 (phase: precheck; optional)
 *   2. provider_publish                 (phase: persistence)
 *   3. publish_confirm                  (phase: finalize; optional)
 *
 * GUARANTEES:
 *   - DUPLICATE PUBLISH SUPPRESSION: the `provider_publish` step's
 *     idempotency fingerprint is `(provider, socialAccountId,
 *     contentFingerprint)`. Same content → same fingerprint → governor
 *     suppresses second invocation. This is the same suppression model
 *     existing socialAdapters already rely on for retry-storm protection.
 *   - REPLAY-SAFE PUBLISH: when the resumable workflow engine restarts
 *     mid-publish, the prior fingerprint stays in the idempotency store,
 *     so re-running `provider_publish` is a no-op via guard().
 *   - threadRootId, when present, is added to the fingerprint so two
 *     posts with the SAME content but different thread roots can still
 *     coexist.
 *
 * SCOPE: step construction ONLY. The actual provider call lives in the
 * caller-injected `runProviderPublish` hook (typically wired to one of
 * xAdapter, linkedinAdapter, instagramAdapter, etc.). The builder NEVER
 * mutates publish state.
 */

import type {
  HydratedQueuePayload,
  ReplayableWorkflowStep,
  WorkflowStepBuilder,
  WorkflowStepBuilderInput,
  WorkflowStepBuilderOutput,
} from '../workflowExecutionTypes';
import type {
  SocialPlatform,
  SocialPublishContext,
  SocialPublishServiceHooks,
  SocialPublishWorkflowParams,
} from './domainWorkflowTypes';

export class SocialPublishBuilderError extends Error {
  constructor(public readonly code: string, message: string) {
    super(`[SocialPublishWorkflowStepBuilder] ${code}: ${message}`);
    this.name = 'SocialPublishBuilderError';
  }
}

export const SOCIAL_PUBLISH_STEP_IDS = {
  validate: 'sp_validate',
  publish: (provider: SocialPlatform, fingerprint: string) =>
    `sp_publish_${provider}_${fingerprint}`,
  confirm: (provider: SocialPlatform) => `sp_confirm_${provider}`,
} as const;

const VALID_PLATFORMS: ReadonlySet<SocialPlatform> = new Set<SocialPlatform>([
  'x', 'linkedin', 'instagram', 'facebook',
  'tiktok', 'youtube', 'pinterest', 'reddit', 'spotify',
]);

export interface CreateSocialPublishWorkflowStepBuilderOptions {
  serviceHooks: SocialPublishServiceHooks;
  name?: string;
}

export function createSocialPublishWorkflowStepBuilder(
  options: CreateSocialPublishWorkflowStepBuilderOptions,
): WorkflowStepBuilder<SocialPublishContext> {
  if (!options || !options.serviceHooks || typeof options.serviceHooks.runProviderPublish !== 'function') {
    throw new SocialPublishBuilderError('MISSING_HOOK', 'runProviderPublish hook required');
  }
  const hooks = options.serviceHooks;
  const builderName = options.name ?? 'social_publish_builder';

  return {
    workflowType: 'social_publish',
    name: builderName,
    async build(input: WorkflowStepBuilderInput<SocialPublishContext>): Promise<WorkflowStepBuilderOutput<SocialPublishContext>> {
      const params = readParams(input.hydrated);
      const ctx: SocialPublishContext = {
        executionId: input.hydrated.payload.executionId,
        provider: params.provider,
        socialAccountId: params.socialAccountId,
        scheduledPostId: params.scheduledPostId,
        contentFingerprint: params.contentFingerprint,
        threadRootId: params.threadRootId ?? null,
      };

      const steps: ReplayableWorkflowStep<SocialPublishContext>[] = [];

      if (hooks.runPublishValidate) {
        steps.push({
          id: SOCIAL_PUBLISH_STEP_IDS.validate,
          phase: 'precheck',
          async run(c) { await hooks.runPublishValidate!(c); },
        });
      }

      // The KEY idempotency boundary. semanticParts intentionally include
      // (provider, socialAccountId, contentFingerprint, threadRootId|null)
      // so two distinct publishes with same content but different threads
      // can coexist, but the SAME publish replayed will be suppressed.
      steps.push({
        id: SOCIAL_PUBLISH_STEP_IDS.publish(params.provider, params.contentFingerprint),
        phase: 'persistence',
        idempotency: {
          cls: 'node_insert',
          semanticParts: [
            'sp', params.provider, params.socialAccountId,
            params.contentFingerprint, params.threadRootId ?? null,
          ],
        },
        async run(c) {
          await hooks.runProviderPublish(c);
        },
      });

      if (hooks.runPublishConfirm) {
        steps.push({
          id: SOCIAL_PUBLISH_STEP_IDS.confirm(params.provider),
          phase: 'finalize',
          idempotency: {
            cls: 'unknown',
            semanticParts: ['sp_confirm', params.provider, params.contentFingerprint],
          },
          async run(c) { await hooks.runPublishConfirm!(c); },
        });
      }

      return { steps, context: ctx };
    },
  };
}

function readParams(hydrated: HydratedQueuePayload): SocialPublishWorkflowParams {
  const raw = (hydrated.payload.workflowParams ?? {}) as Record<string, unknown>;
  if (typeof raw.subType === 'string' && raw.subType !== 'social_publish') {
    throw new SocialPublishBuilderError('SUBTYPE_MISMATCH', `expected 'social_publish', got '${raw.subType}'`);
  }
  const provider = typeof raw.provider === 'string' ? raw.provider : '';
  if (!VALID_PLATFORMS.has(provider as SocialPlatform)) {
    throw new SocialPublishBuilderError('INVALID_PROVIDER', `unknown provider='${provider}'`);
  }
  if (typeof raw.socialAccountId !== 'string' || raw.socialAccountId.length === 0) {
    throw new SocialPublishBuilderError('MISSING_FIELD', 'socialAccountId required');
  }
  if (typeof raw.scheduledPostId !== 'string' || raw.scheduledPostId.length === 0) {
    throw new SocialPublishBuilderError('MISSING_FIELD', 'scheduledPostId required');
  }
  if (typeof raw.contentFingerprint !== 'string' || raw.contentFingerprint.length === 0) {
    throw new SocialPublishBuilderError('MISSING_FIELD', 'contentFingerprint required');
  }
  return {
    subType: 'social_publish',
    provider: provider as SocialPlatform,
    socialAccountId: raw.socialAccountId,
    scheduledPostId: raw.scheduledPostId,
    contentFingerprint: raw.contentFingerprint,
    threadRootId: typeof raw.threadRootId === 'string' ? raw.threadRootId : undefined,
    retryBudgetHint: typeof raw.retryBudgetHint === 'number' ? raw.retryBudgetHint : undefined,
  };
}

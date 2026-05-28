/**
 * Phase 24B — CampaignWorkflowStepBuilder
 *
 * Translates queue payloads with `workflowType='campaign_execution'`
 * into a replay-safe step sequence:
 *
 *   1. campaign_precheck                (phase: precheck)
 *   2. post_<postId>                    (phase: persistence, one per post)
 *   3. campaign_finalize                (phase: finalize)
 *
 * GUARANTEES:
 *   - Stable step IDs across replays: `camp_precheck`, `post_<postId>`,
 *     `camp_finalize`.
 *   - Per-post idempotency on (campaignId, postId).
 *   - `staggerMs` is ADVISORY — the substrate's runner is sequential per
 *     execution, so staggering is at most a soft hint passed to hooks via
 *     context. Strict scheduling is the campaign service's responsibility.
 *   - Empty `posts` payload short-circuits to precheck + finalize so the
 *     workflow has a valid (empty) progression.
 */

import type {
  HydratedQueuePayload,
  ReplayableWorkflowStep,
  WorkflowStepBuilder,
  WorkflowStepBuilderInput,
  WorkflowStepBuilderOutput,
} from '../workflowExecutionTypes';
import type {
  CampaignContext,
  CampaignServiceHooks,
  CampaignWorkflowParams,
} from './domainWorkflowTypes';

export class CampaignBuilderError extends Error {
  constructor(public readonly code: string, message: string) {
    super(`[CampaignWorkflowStepBuilder] ${code}: ${message}`);
    this.name = 'CampaignBuilderError';
  }
}

export const CAMPAIGN_STEP_IDS = {
  precheck: 'camp_precheck',
  post: (postId: string) => `camp_post_${postId}`,
  finalize: 'camp_finalize',
} as const;

export interface CreateCampaignWorkflowStepBuilderOptions {
  serviceHooks: CampaignServiceHooks;
  name?: string;
}

export function createCampaignWorkflowStepBuilder(
  options: CreateCampaignWorkflowStepBuilderOptions,
): WorkflowStepBuilder<CampaignContext> {
  if (!options || !options.serviceHooks || typeof options.serviceHooks.runPost !== 'function') {
    throw new CampaignBuilderError('MISSING_HOOK', 'runPost hook required');
  }
  const hooks = options.serviceHooks;
  const builderName = options.name ?? 'campaign_builder';

  return {
    workflowType: 'campaign_execution',
    name: builderName,
    async build(input: WorkflowStepBuilderInput<CampaignContext>): Promise<WorkflowStepBuilderOutput<CampaignContext>> {
      const params = readParams(input.hydrated);
      const ctx: CampaignContext = {
        executionId: input.hydrated.payload.executionId,
        campaignId: params.campaignId,
        totalPosts: params.posts.length,
      };

      const steps: ReplayableWorkflowStep<CampaignContext>[] = [];

      steps.push({
        id: CAMPAIGN_STEP_IDS.precheck,
        phase: 'precheck',
        async run(c) {
          if (hooks.runCampaignPrecheck) await hooks.runCampaignPrecheck(c);
        },
      });

      for (const post of params.posts) {
        const postMeta = post.meta ?? {};
        steps.push({
          id: CAMPAIGN_STEP_IDS.post(post.postId),
          phase: 'persistence',
          idempotency: {
            cls: 'scheduling',
            semanticParts: ['camp', params.campaignId, post.postId],
          },
          async run(c) {
            await hooks.runPost(c, post.postId, postMeta);
          },
        });
      }

      steps.push({
        id: CAMPAIGN_STEP_IDS.finalize,
        phase: 'finalize',
        idempotency: {
          cls: 'unknown',
          semanticParts: ['camp_final', params.campaignId],
        },
        async run(c) {
          if (hooks.runCampaignFinalize) await hooks.runCampaignFinalize(c);
        },
      });

      return { steps, context: ctx };
    },
  };
}

function readParams(hydrated: HydratedQueuePayload): CampaignWorkflowParams {
  const raw = (hydrated.payload.workflowParams ?? {}) as Record<string, unknown>;
  if (typeof raw.subType === 'string' && raw.subType !== 'campaign_execution') {
    throw new CampaignBuilderError('SUBTYPE_MISMATCH', `expected 'campaign_execution', got '${raw.subType}'`);
  }
  const campaignId = typeof raw.campaignId === 'string' && raw.campaignId.length > 0
    ? raw.campaignId
    : hydrated.payload.executionId;
  const postsRaw = Array.isArray(raw.posts) ? raw.posts : [];
  const posts: CampaignWorkflowParams['posts'] = [];
  for (const p of postsRaw) {
    if (typeof p !== 'object' || p === null) continue;
    const obj = p as Record<string, unknown>;
    if (typeof obj.postId !== 'string') continue;
    posts.push({
      postId: obj.postId,
      scheduledAtIso: typeof obj.scheduledAtIso === 'string' ? obj.scheduledAtIso : undefined,
      meta: (obj.meta as Record<string, unknown> | undefined) ?? undefined,
    });
  }
  return {
    subType: 'campaign_execution',
    campaignId, posts,
    staggerMs: typeof raw.staggerMs === 'number' ? raw.staggerMs : undefined,
    failFast: typeof raw.failFast === 'boolean' ? raw.failFast : false,
  };
}

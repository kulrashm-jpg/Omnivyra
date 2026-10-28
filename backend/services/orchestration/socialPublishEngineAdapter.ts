/**
 * The social publishing engine (BOLT / publish queue), as an orchestration adapter.
 *
 * ─── FINDING: THERE IS NO ENTRY POINT A WORKFLOW STEP CAN HONESTLY REACH ─────
 * Every way the engine creates or publishes a post starts from data a workflow
 * step does not carry:
 *
 *   publish        `publishNow({ scheduled_post_id, social_account_id, user_id })`
 *                  (backend/services/publishNowService.ts) and the queue worker
 *                  `processPublishJob` (backend/queue/jobProcessors/publishProcessor.ts)
 *                  act on an EXISTING `scheduled_posts` row.
 *   schedule       the only creators of `scheduled_posts` rows are campaign-bound:
 *                  `processBlockSchedule` (boltScheduleBlockProcessor.ts, from
 *                  `daily_content_plans` rows of a campaign), the creator row
 *                  schedulers (creator/creatorRowScheduler.ts, also from a
 *                  campaign's `daily_content_plans` row) and the HTTP route
 *                  pages/api/activity-workspace/schedule.ts (requires campaignId,
 *                  platform, literal content and scheduledDate).
 *   approval       is enforced at the campaign RELEASE seam
 *                  (lib/campaign/campaignRelease.ts): draft/review copy is never
 *                  scheduled, so a post's existence IS its approval
 *                  (lib/campaign/publishAuthorization.ts). A post created any
 *                  other way would carry no approval at all.
 *
 * A workflow step (workflows/workflowStore.ts `WorkflowStep`) supplies only a
 * channel, timing, autonomy policy, conditions and an optional `instruction`
 * that is "personalization INSTRUCTIONS only, never data". It names no campaign,
 * no plan row, no scheduled post, no platform, no social account and no post
 * text. Turning it into a publication would mean inventing the post, its target
 * account and its approval — and, because a journey step runs once PER PERSON
 * while a social post is public and tenant-wide, N enrolled people would mean N
 * public posts.
 *
 * So this adapter performs nothing and reports `unsupported` → `needs_human` for
 * every step, with the exact missing interface as its reason. It never creates a
 * post, never enqueues a job and never re-routes the step to another engine.
 * Because it never acts, it needs no `execution_engine_requests` row: there is
 * no external action to make idempotent, and re-execution is trivially safe.
 *
 * ─── CHANNEL ─────────────────────────────────────────────────────────────
 * `content` is the only channel in WORKFLOW_STEP_CHANNELS that could name
 * publishing (the others are person-addressed transports or `community`, which
 * has its own engine name). Note for the integration owner: everywhere else in
 * the codebase `content` means "share a resource WITH this prospect"
 * (qualificationPlanning/planningConfig.ts: "Case study", "Whitepaper", "API
 * guide"; automationExecution/taskGenerator.ts maps it to a `content` task), not
 * public social publishing. Claiming it here keeps such steps visibly
 * unsupported with a precise reason; whether `content` should belong to this
 * engine at all is the owner's decision.
 */

import type { EngineAdapter, EngineResult, EngineStepContext } from './engineAdapters';

export const SOCIAL_PUBLISH_CHANNELS = ['content'] as const;

export const SOCIAL_PUBLISH_UNSUPPORTED_OUTCOME = 'unsupported';

/**
 * The concrete interface the engine lacks. A code-level reason, never personal
 * data; it is what a person sees on the step.
 */
export const SOCIAL_PUBLISH_MISSING_INTERFACE =
  'social publishing needs a released campaign post (scheduled_posts row from an approved '
  + 'daily_content_plans row: campaign, platform, social account, approved copy); a workflow '
  + 'step supplies none of these and the engine has no per-task publish request, so nothing was published';

export function createSocialPublishAdapter(): EngineAdapter {
  return {
    engine: 'social_publish',
    channels: SOCIAL_PUBLISH_CHANNELS,
    async execute(_ctx: EngineStepContext): Promise<EngineResult> {
      return {
        engine: 'social_publish',
        outcome: SOCIAL_PUBLISH_UNSUPPORTED_OUTCOME,
        disposition: 'needs_human',
        reason: SOCIAL_PUBLISH_MISSING_INTERFACE,
        externalRef: null,
      };
    },
  };
}

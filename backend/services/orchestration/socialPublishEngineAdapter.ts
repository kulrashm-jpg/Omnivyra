/**
 * The social publishing engine (BOLT / publish queue), as an orchestration adapter.
 *
 * Contract and semantics: ./socialPostStepContract.ts. In short — a `social_post`
 * step references ONE released `scheduled_posts` row of its own tenant, and
 * AWAITS that row's publication by the engine. The adapter only READS the
 * engine's records; it never publishes, schedules, enqueues, reschedules,
 * cancels or writes anything. It claims only `social_post`; `content` (sharing
 * a resource with a prospect) is not this engine's channel.
 *
 * ─── WHY IT CANNOT ACT PER TASK ──────────────────────────────────────────
 *   publishNow({ scheduled_post_id, social_account_id, user_id })
 *     (backend/services/publishNowService.ts:180, :522) needs a verified acting
 *     USER, which an execution task does not carry, and it does NOT evaluate the
 *     publish authorization predicate (publishNowService.ts:303: authorization
 *     stays at the route/worker layer). Calling it from a journey would bypass
 *     that gate and pull the post off the time it was RELEASED for.
 *   processPublishJob (backend/queue/jobProcessors/publishProcessor.ts:109) is a
 *     BullMQ consumer keyed by its job id, enqueued by the scheduler for a row
 *     already due; a journey task is not a job.
 *   The engine's durable idempotency is POST-LEVEL (claimScheduledPostForPublish,
 *     publishNowService.ts:380, a CAS on scheduled_posts.status), while the
 *     request ledger `execution_engine_requests` is unique per EXECUTION TASK
 *     (UNIQUE (organization_id, execution_task_id), 20261230000000:64). N people
 *     → N ledger rows, all naming the same post: that ledger cannot express
 *     "once per object", and the post-level claim already does.
 *
 * Hence no `execution_engine_requests` row is written. With no external action
 * there is nothing to make idempotent; every execute is a pure read, safe to
 * repeat or run concurrently, and the one publication stays the engine's.
 *
 * ─── TENANCY ─────────────────────────────────────────────────────────────
 * `scheduled_posts` has no tenant column. Its tenant is the owning social
 * account's `company_id` — the canonical publishing owner
 * (creator/publishingOrganizationResolver.ts). The post must resolve to the
 * task's organization through its account, and through its campaign when it has
 * one; any disagreement or unreadable owner is reported exactly like a missing
 * post (`reference_not_found`, no external ref), so another tenant's post cannot
 * even be confirmed to exist.
 *
 * ─── CANCELLATION ────────────────────────────────────────────────────────
 * Cancelling a journey (or a step) has nothing to undo here: this adapter never
 * acted, and it must never cancel the post, which other people's tasks and the
 * campaign share. A post cancelled on the campaign side settles every
 * referencing step `skipped`.
 */

import { ownedDbTable } from '../../db/writeOwner';
import type { EngineAdapter, EngineResult, EngineStepContext } from './engineAdapters';
import { SOCIAL_POST_CHANNEL, parseSocialPostSettings } from './socialPostStepContract';
import { classifyScheduledPost, type ScheduledPostFacts } from './socialPostPublicationStatus';

export const SOCIAL_PUBLISH_CHANNELS = [SOCIAL_POST_CHANNEL] as const;

export interface ScheduledPostRow {
  readonly id: string;
  readonly status: string | null;
  readonly platform_post_id: string | null;
  readonly error_code: string | null;
  readonly is_thread_start: boolean | null;
  readonly content: string | null;
  readonly campaign_id: string | null;
  readonly social_account_id: string | null;
}

/** READ-ONLY dependencies. There is deliberately no write dependency at all. */
export interface SocialPublishAdapterDeps {
  readScheduledPost(scheduledPostId: string): Promise<ScheduledPostRow | null>;
  /** `social_accounts.company_id`, or null when absent. Throws when unreadable. */
  readAccountOrganization(socialAccountId: string): Promise<string | null>;
  /** The campaign's owner and status, or null when absent. Throws when unreadable. */
  readCampaign(campaignId: string): Promise<{ company_id: string | null; status: string | null } | null>;
}

const readFailure = (what: string): Error =>
  Object.assign(new Error(`${what} unreadable`), { code: 'read_failed' });

const s = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

export const defaultSocialPublishDeps: SocialPublishAdapterDeps = {
  async readScheduledPost(scheduledPostId) {
    const res = await ownedDbTable('scheduled_posts')
      .select('id, status, platform_post_id, error_code, is_thread_start, content, campaign_id, social_account_id')
      .eq('id', scheduledPostId)
      .maybeSingle();
    if (res.error) throw readFailure('scheduled post');
    if (!res.data) return null;
    const r = res.data as Record<string, unknown>;
    return {
      id: String(r.id),
      status: s(r.status),
      platform_post_id: s(r.platform_post_id),
      error_code: s(r.error_code),
      is_thread_start: r.is_thread_start === true,
      content: typeof r.content === 'string' ? r.content : null,
      campaign_id: s(r.campaign_id),
      social_account_id: s(r.social_account_id),
    };
  },
  async readAccountOrganization(socialAccountId) {
    const res = await ownedDbTable('social_accounts').select('company_id').eq('id', socialAccountId).maybeSingle();
    if (res.error) throw readFailure('social account');
    return s((res.data as { company_id?: unknown } | null)?.company_id);
  },
  async readCampaign(campaignId) {
    const res = await ownedDbTable('campaigns').select('company_id, status').eq('id', campaignId).maybeSingle();
    if (res.error) throw readFailure('campaign');
    if (!res.data) return null;
    const r = res.data as Record<string, unknown>;
    return { company_id: s(r.company_id), status: s(r.status) };
  },
};

export const SOCIAL_POST_NOT_FOUND_REASON = 'the referenced scheduled post does not exist in this tenant';

export function createSocialPublishAdapter(deps: SocialPublishAdapterDeps = defaultSocialPublishDeps): EngineAdapter {
  const result = (outcome: string, disposition: EngineResult['disposition'], reason: string | null, externalRef: string | null): EngineResult =>
    ({ engine: 'social_publish', outcome, disposition, reason, externalRef });

  return {
    engine: 'social_publish',
    channels: SOCIAL_PUBLISH_CHANNELS,
    async execute(ctx: EngineStepContext): Promise<EngineResult> {
      // 1. The step must carry a structurally valid reference. A snapshot that
      //    predates the field, or a hand-written step, is refused — never guessed.
      const step = ctx.step as (EngineStepContext['step'] & { social_post?: unknown }) | null;
      if (ctx.channel !== SOCIAL_POST_CHANNEL || step === null || step.channel !== SOCIAL_POST_CHANNEL) {
        return result('reference_missing', 'needs_human', 'only a social_post step can reference an approved post', null);
      }
      const parsed = parseSocialPostSettings(step.social_post, step.key);
      if (parsed.ok === false) return result('reference_missing', 'needs_human', parsed.code, null);
      const postId = parsed.settings.scheduled_post_id;

      // 2. Read the engine's own records. Nothing has been (or will be) done, so
      //    a read failure is provably "not acted" → wait.
      let row: ScheduledPostRow | null;
      let campaign: { company_id: string | null; status: string | null } | null = null;
      let accountOrg: string | null = null;
      try {
        row = await deps.readScheduledPost(postId);
        if (row && row.social_account_id) accountOrg = await deps.readAccountOrganization(row.social_account_id);
        if (row && row.campaign_id) campaign = await deps.readCampaign(row.campaign_id);
      } catch {
        return result('read_failed', 'wait', 'the engine\'s records could not be read; nothing was done', null);
      }

      // 3. Tenant: the account owner must be this tenant; a campaign, when
      //    present, must agree. Every failure looks like "not found".
      const org = ctx.organizationId.toLowerCase();
      if (
        row === null
        || accountOrg === null || accountOrg.toLowerCase() !== org
        || (row.campaign_id !== null && (campaign === null || campaign.company_id === null || campaign.company_id.toLowerCase() !== org))
      ) {
        return result('reference_not_found', 'needs_human', SOCIAL_POST_NOT_FOUND_REASON, null);
      }

      // 4. Classify the one shared post. The external ref is the engine's own id
      //    for the work — identical for every person's task.
      const facts: ScheduledPostFacts = {
        id: row.id,
        status: row.status,
        platform_post_id: row.platform_post_id,
        error_code: row.error_code,
        is_thread_start: row.is_thread_start === true,
        has_content: typeof row.content === 'string' && row.content.trim() !== '',
        campaign_id: row.campaign_id,
        campaign_status: campaign ? campaign.status : undefined,
      };
      const c = classifyScheduledPost(facts);
      return result(c.outcome, c.disposition, c.reason, row.id);
    },
  };
}

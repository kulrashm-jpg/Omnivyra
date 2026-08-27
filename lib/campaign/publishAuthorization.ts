/**
 * R2-IMPL B1 — per-post publish authorization (PURE).
 *
 * THE single predicate that decides whether one scheduled post may be
 * published. Both consumers use it, so BOLT and Strategic Mix cannot diverge:
 *
 *   backend/scheduler/schedulerService.ts   — cron enqueue eligibility
 *   backend/queue/jobProcessors/publishProcessor.ts — publish-time gate
 *
 * ── The governance change it implements ────────────────────────────────────
 * Publishing was gated on CAMPAIGN-GLOBAL readiness
 * (`campaign_readiness.readiness_state === 'ready'`, which requires the whole
 * campaign to be 100% planned AND 100% scheduled). That made partial release
 * impossible — releasing weeks 1-2 of a six-week campaign left readiness at
 * `partial`, which blocked the released weeks too — and in production it was
 * satisfied by ZERO campaigns (1 readiness row, 0 `ready`), so nothing reached
 * a platform through the worker at all.
 *
 * Authorization is now a property of the POST, not of the campaign's planning
 * completeness. `campaign_readiness` remains a planning/diagnostic metric
 * (Board, guidance, health) and no longer authorizes publication.
 *
 * ── Why no safety is lost (R2 §5 mapping) ──────────────────────────────────
 * Every property the readiness formula indirectly protected has a per-post
 * equivalent that is enforced elsewhere and is STRICTER, because it is scoped
 * to the post actually being published:
 *
 *   readiness component          →  per-post replacement
 *   ───────────────────────────     ────────────────────────────────────────
 *   C1/C2 weekly structure       →  the post exists ⇒ its plan row was
 *                                   scheduled. Other weeks are irrelevant.
 *   C3 every plan has content    →  `has_content` here + validatePublishReadiness
 *   C4 media ready               →  validatePublishReadiness (publishProcessor)
 *   C5 everything scheduled      →  `post_status` here — THIS post is released
 *   (approval: never in the      →  enforced at the release seam
 *    readiness formula at all)      (lib/campaign/campaignRelease): draft and
 *                                   review rows are never scheduled, so no
 *                                   scheduled_posts row can exist for them.
 *
 * That last line is the structural guarantee behind partial release: an
 * unreleased week has no scheduled post, so there is nothing to authorize.
 *
 * Pure and deterministic: same facts → same verdict. No I/O, no clock.
 */

export type PublishAuthorizationCode =
  | 'AUTHORIZED'
  | 'PUBLISH_BLOCKED_CAMPAIGN_NOT_ACTIVE'
  | 'PUBLISH_BLOCKED_POST_NOT_RELEASED'
  | 'PUBLISH_BLOCKED_POST_NO_CONTENT'
  | 'PUBLISH_ALREADY_PUBLISHED';

/**
 * Post statuses that represent a released execution record.
 *
 *  scheduled   — the scheduler released it (processBlockSchedule inserts this)
 *  publishing  — a publish attempt is in flight
 *  failed      — a previous attempt failed; BullMQ retries the SAME job, so
 *                this MUST stay releasable or every retry would be rejected
 *
 * Deliberately excluded: `draft` (the column default — a row that exists but
 * was never released), `pending`, `cancelled`, and absent/unknown.
 */
export const RELEASABLE_POST_STATUSES: ReadonlySet<string> = new Set([
  'scheduled',
  'publishing',
  'failed',
]);

export interface PublishAuthorizationFacts {
  /** null/absent ⇒ a standalone post with no campaign (dashboard scheduler). */
  campaign_id?: string | null;
  /** The owning campaign's `status`. undefined ⇒ campaign row unreadable/missing. */
  campaign_status?: string | null;
  /** `scheduled_posts.status`. */
  post_status?: string | null;
  /** Set once a platform accepted the post. */
  platform_post_id?: string | null;
  /**
   * Thread roots keep publishing after the root lands (children may be
   * pending), so a set platform_post_id is NOT terminal for them.
   */
  is_thread_start?: boolean;
  /** False ⇒ the post has no body to publish. undefined ⇒ not evaluated here. */
  has_content?: boolean;
}

export interface PublishAuthorization {
  authorized: boolean;
  code: PublishAuthorizationCode;
  reason: string;
  /** True for the idempotent already-published case: skip, do NOT fail. */
  already_published: boolean;
}

const ok = (): PublishAuthorization => ({
  authorized: true,
  code: 'AUTHORIZED',
  reason: 'post is released on an active campaign',
  already_published: false,
});

const deny = (
  code: PublishAuthorizationCode,
  reason: string,
  already_published = false,
): PublishAuthorization => ({ authorized: false, code, reason, already_published });

const norm = (v: unknown): string => String(v ?? '').trim().toLowerCase();

/**
 * Authorize ONE scheduled post. Ordered most-terminal first so the reported
 * code is the most actionable one.
 */
export function authorizePostPublish(facts: PublishAuthorizationFacts): PublishAuthorization {
  // 1. Campaign gate — unchanged from before B1, and still mandatory.
  //    Applies ONLY to campaign-linked posts, exactly as it did previously;
  //    standalone posts have no campaign to be active.
  const campaignId = typeof facts.campaign_id === 'string' ? facts.campaign_id.trim() : '';
  if (campaignId) {
    if (norm(facts.campaign_status) !== 'active') {
      return deny(
        'PUBLISH_BLOCKED_CAMPAIGN_NOT_ACTIVE',
        'the campaign is not active',
      );
    }
  }

  // 2. Idempotency — a published post is skipped, never re-published.
  //    Thread roots are exempt: their children may still be pending.
  const platformPostId = typeof facts.platform_post_id === 'string' ? facts.platform_post_id.trim() : '';
  if (platformPostId && facts.is_thread_start !== true) {
    return deny(
      'PUBLISH_ALREADY_PUBLISHED',
      'the post was already published',
      true,
    );
  }

  // 3. Release gate — THE replacement for campaign-global readiness.
  //    A post that was never released has no business reaching a platform,
  //    however complete (or incomplete) the rest of the campaign is.
  if (!RELEASABLE_POST_STATUSES.has(norm(facts.post_status))) {
    return deny(
      'PUBLISH_BLOCKED_POST_NOT_RELEASED',
      `the post is not released (status "${norm(facts.post_status) || 'none'}")`,
    );
  }

  // 4. Content presence. Platform-specific validation stays with
  //    validatePublishReadiness; this only rejects an empty body.
  if (facts.has_content === false) {
    return deny('PUBLISH_BLOCKED_POST_NO_CONTENT', 'the post has no content to publish');
  }

  return ok();
}

/** True when this post may be enqueued/published. Convenience for callers
 *  that do not need the reason. */
export function isPostPublishAuthorized(facts: PublishAuthorizationFacts): boolean {
  return authorizePostPublish(facts).authorized;
}

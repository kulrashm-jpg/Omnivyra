/**
 * How the engine's record of ONE released post settles a `social_post` journey
 * step (contract: ./socialPostStepContract.ts). Pure: no I/O. The adapter
 * (./socialPublishEngineAdapter.ts) supplies the facts it read.
 *
 * Status mapping (every person's task on the same post gets the same answer):
 *   platform_post_id set                         → published            / completed
 *   uncertain marker (PUBLISH_OUTCOME_UNCERTAIN,
 *     PUBLISH_CALL_STARTED), or 'published'
 *     with no platform id                         → uncertain            / needs_human
 *   'publishing' (a claim or call in flight)      → publishing           / wait
 *   'cancelled'                                   → cancelled            / skipped
 *   not released ('draft', unknown) / 'blocked'   → not_released|blocked / needs_human
 *   campaign not active / no content              → engine gate code     / needs_human
 *   'failed'                                      → publish_failed       / needs_human
 *   'scheduled'                                   → awaiting_publication / wait
 *   thread root                                   → thread_unsupported   / needs_human
 * `failed` is never chosen; nothing here can lead to a second publication.
 */

import { authorizePostPublish } from '../../../lib/campaign/publishAuthorization';
import { publishOutcomeBlocksAttempt } from '../../queue/publishOutcome';
import type { EngineDisposition } from './engineAdapters';


/** The facts the adapter reads from the engine's own records. */
export interface ScheduledPostFacts {
  readonly id: string;
  readonly status: string | null;
  readonly platform_post_id: string | null;
  readonly error_code: string | null;
  readonly is_thread_start: boolean;
  readonly has_content: boolean;
  readonly campaign_id: string | null;
  /** `campaigns.status`; undefined when the post has no campaign or it is unreadable. */
  readonly campaign_status?: string | null;
}

/** Outcomes this contract reports (the adapter's `outcome`). */
export const SOCIAL_POST_OUTCOMES = [
  'reference_missing',
  'reference_not_found',
  'published',
  'awaiting_publication',
  'publishing',
  'uncertain',
  'publish_failed',
  'cancelled',
  'not_released',
  'blocked',
  'thread_unsupported',
  'read_failed',
] as const;
export type SocialPostOutcome = typeof SOCIAL_POST_OUTCOMES[number];

export interface SocialPostClassification {
  readonly outcome: SocialPostOutcome | string;
  readonly disposition: EngineDisposition;
  readonly reason: string | null;
}

/** The exact capability a "publish when the person reaches this step" step would need. */
export const SOCIAL_POST_TRIGGER_UNSUPPORTED =
  'the social publishing engine has no per-task publish request: publishNow and the publish queue act on a '
  + 'released scheduled_posts row under a verified user and that row\'s released time, and the publication is '
  + 'ONE public object while a journey step runs once per person; a social_post step can only await the '
  + 'released post\'s own publication, so nothing was published';

const norm = (v: unknown): string => String(v ?? '').trim().toLowerCase();

/**
 * Map the engine's record of ONE post to how this person's step settles. The
 * same row gives every person's task the same answer: the publication is shared.
 * Ordered most-terminal first.
 */
export function classifyScheduledPost(f: ScheduledPostFacts): SocialPostClassification {
  const status = norm(f.status);

  // Threads: a root's platform_post_id or status says nothing about its children
  // (publishNowService delegates them to publishThread). Not observed here.
  if (f.is_thread_start) {
    return { outcome: 'thread_unsupported', disposition: 'needs_human', reason: 'the referenced post is a multi-post thread; its completion is not observable as one object' };
  }

  // Published: the platform accepted it. Completed for every person, once.
  if (typeof f.platform_post_id === 'string' && f.platform_post_id.trim() !== '') {
    return { outcome: 'published', disposition: 'completed', reason: null };
  }

  // A previous attempt MAY have published it: never wait for (and so never
  // invite) another attempt; a person reconciles.
  const block = publishOutcomeBlocksAttempt({ status: f.status, error_code: f.error_code, platform_post_id: f.platform_post_id });
  if (block === 'uncertain') {
    return { outcome: 'uncertain', disposition: 'needs_human', reason: 'the engine recorded that a publish attempt may have reached the platform; a person must reconcile it' };
  }
  if (status === 'published') {
    // Published status without a platform id is the engine's own "ambiguous success".
    return { outcome: 'uncertain', disposition: 'needs_human', reason: 'the post is marked published but carries no platform post id' };
  }
  if (block === 'in_flight' || status === 'publishing') {
    return { outcome: 'publishing', disposition: 'wait', reason: 'the engine is publishing the post' };
  }

  if (status === 'cancelled') {
    // The approved object was withdrawn; no publication will happen. The journey
    // advances — it never re-creates or re-releases a post.
    return { outcome: 'cancelled', disposition: 'skipped', reason: 'the referenced post was cancelled' };
  }

  // The engine's own authorization predicate (campaign active, released, has content).
  const auth = authorizePostPublish({
    campaign_id: f.campaign_id,
    campaign_status: f.campaign_status,
    post_status: f.status,
    platform_post_id: f.platform_post_id,
    is_thread_start: f.is_thread_start,
    has_content: f.has_content,
  });
  if (!auth.authorized) {
    if (auth.code === 'PUBLISH_BLOCKED_POST_NOT_RELEASED') {
      const outcome = status === 'blocked' ? 'blocked' : 'not_released';
      return { outcome, disposition: 'needs_human', reason: `${auth.code}: a social_post step may only reference a released post` };
    }
    return { outcome: auth.code, disposition: 'needs_human', reason: auth.reason };
  }

  if (status === 'failed') {
    // The engine may retry this itself (queue attempts) or may have given up;
    // either way the journey neither retries nor waits forever.
    return { outcome: 'publish_failed', disposition: 'needs_human', reason: 'the engine\'s publish attempt failed; a person decides whether it is republished' };
  }
  if (status === 'scheduled') {
    return { outcome: 'awaiting_publication', disposition: 'wait', reason: 'the released post has not been published yet' };
  }
  return { outcome: status || 'unknown', disposition: 'needs_human', reason: `the referenced post is in an unexpected state (${status || 'none'})` };
}

/**
 * Closure-005 — who may unschedule or re-time the scheduled post linked to an
 * activity-workspace plan row, and in which states.
 *
 * The activity-workspace routes authorize the PLAN row at company level
 * (enforceCompanyAccess on the campaign's company: any active member, any
 * role). A scheduled post, however, is owned by a USER (scheduled_posts.user_id
 * — the same scoping as /api/scheduler/*, /api/schedule/* and the owner check
 * in /api/social/publish). Company membership alone therefore never
 * authorizes changing another user's post: the caller must own it, or be a
 * platform SUPER_ADMIN (rbacService.isSuperAdmin — the real DB role, the same
 * exception /api/social/publish makes).
 *
 * And the post must be in a state where the change cannot lose or repeat a
 * publication (backend/queue/publishOutcome.ts):
 *   published  (platform_post_id / 'published')   → 409 POST_ALREADY_PUBLISHED
 *   in flight  (publishing / claimed / fenced)     → 409 POST_PUBLISH_IN_PROGRESS
 *   uncertain  (UNCERTAIN / CALL_STARTED, and a    → 409 PUBLISH_OUTCOME_UNCERTAIN
 *               code-less failed thread node)
 * A thread is judged as a whole (root + every child), and a thread CHILD is
 * never unscheduled or re-timed on its own — only with its root.
 */

import { supabase } from '../db/supabaseClient';
import { isSuperAdmin } from './rbacService';
import {
  classifySinglePostIdentity,
  classifyThreadNodeIdentity,
  type ThreadNodeIdentity,
} from '../queue/publishOutcome';

export type LinkedPost = {
  id: string;
  user_id: string | null;
  campaign_id: string | null;
  status: string | null;
  error_code: string | null;
  platform_post_id: string | null;
  is_thread_start: boolean | null;
  parent_post_id: string | null;
};

export type LinkedPostDecision =
  | { ok: true; post: LinkedPost | null; threadChildren: LinkedPost[] }
  | { ok: false; httpStatus: 403 | 409 | 503; code: string; error: string; nodeIds?: string[] };

const POST_COLUMNS = 'id, user_id, campaign_id, status, error_code, platform_post_id, is_thread_start, parent_post_id';

const IDENTITY_REFUSAL: Record<Exclude<ThreadNodeIdentity, 'replaceable'>, { code: string; error: string }> = {
  published: {
    code: 'POST_ALREADY_PUBLISHED',
    error: 'This post is already published. Published posts are never unscheduled or re-timed (they are already live on the platform).',
  },
  in_flight: {
    code: 'POST_PUBLISH_IN_PROGRESS',
    error: 'This post is being published right now. Try again once publishing has finished.',
  },
  uncertain: {
    code: 'PUBLISH_OUTCOME_UNCERTAIN',
    error: 'This post may already have been published: its last attempt reached the platform but the result was not ' +
      'saved. Check the platform and have the outcome reconciled first.',
  },
};

export async function authorizeLinkedPostMutation(input: {
  /** The post id the plan row links to, or null when it links none. */
  postId: string | null;
  /** The plan row's (authorized) campaign. */
  campaignId: string;
  /** The AUTHENTICATED user (from enforceCompanyAccess) — never a body field. */
  userId: string;
  /** 'allow': a link to a post that no longer exists is not an error (unschedule). */
  missingPost: 'allow' | 'refuse';
}): Promise<LinkedPostDecision> {
  if (!input.postId) return { ok: true, post: null, threadChildren: [] };

  const { data, error } = await supabase
    .from('scheduled_posts')
    .select(POST_COLUMNS)
    .eq('id', input.postId)
    .maybeSingle();
  if (error) {
    return { ok: false, httpStatus: 503, code: 'SCHEDULED_POST_LOOKUP_FAILED', error: 'Failed to verify the scheduled post. Please retry.' };
  }
  const post = (data ?? null) as LinkedPost | null;
  if (!post) {
    return input.missingPost === 'allow'
      ? { ok: true, post: null, threadChildren: [] }
      : { ok: false, httpStatus: 409, code: 'SCHEDULED_POST_NOT_IN_CAMPAIGN', error: 'The scheduled post linked to this row does not belong to its campaign.' };
  }
  // 3AH-92 — the post must belong to the row's own (authorized) campaign.
  if (String(post.campaign_id ?? '') !== String(input.campaignId)) {
    return { ok: false, httpStatus: 409, code: 'SCHEDULED_POST_NOT_IN_CAMPAIGN', error: 'The scheduled post linked to this row does not belong to its campaign.' };
  }
  // Ownership — company membership alone is not enough.
  if (post.user_id !== input.userId && !(await isSuperAdmin(input.userId))) {
    return { ok: false, httpStatus: 403, code: 'SCHEDULED_POST_NOT_OWNED', error: 'Only the owner of this scheduled post can change it.' };
  }
  if (post.parent_post_id) {
    return {
      ok: false, httpStatus: 409, code: 'THREAD_CHILD_NOT_STANDALONE',
      error: 'This post is part of a thread. Unschedule or re-time the thread from its first post.',
    };
  }

  let threadChildren: LinkedPost[] = [];
  if (post.is_thread_start === true) {
    const { data: childData, error: childError } = await supabase
      .from('scheduled_posts')
      .select(POST_COLUMNS)
      .eq('parent_post_id', post.id);
    if (childError) {
      return { ok: false, httpStatus: 503, code: 'SCHEDULED_POST_LOOKUP_FAILED', error: 'Failed to verify the thread. Please retry.' };
    }
    threadChildren = (Array.isArray(childData) ? childData : []) as LinkedPost[];
    const foreign = threadChildren.filter((c) => c.user_id !== post.user_id).map((c) => c.id);
    if (foreign.length > 0) {
      return { ok: false, httpStatus: 409, code: 'THREAD_OWNERSHIP_CONFLICT', error: 'This thread contains posts that belong to another user.', nodeIds: foreign };
    }
  }

  const nodes: Array<[LinkedPost, ThreadNodeIdentity]> = post.is_thread_start === true
    ? [post, ...threadChildren].map((n) => [n, classifyThreadNodeIdentity(n)] as [LinkedPost, ThreadNodeIdentity])
    : [[post, classifySinglePostIdentity(post)]];
  for (const identity of ['published', 'in_flight', 'uncertain'] as const) {
    const hit = nodes.filter(([, id]) => id === identity).map(([n]) => n.id);
    if (hit.length > 0) return { ok: false, httpStatus: 409, ...IDENTITY_REFUSAL[identity], nodeIds: hit };
  }
  return { ok: true, post, threadChildren };
}

/** Compare-and-set predicate on the error_code that was read. */
export function pinErrorCode<Q extends { is: (c: string, v: null) => Q; eq: (c: string, v: string) => Q }>(
  query: Q,
  code: string | null | undefined,
): Q {
  return code == null ? query.is('error_code', null) : query.eq('error_code', code);
}
